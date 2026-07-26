import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { parseDateRangeStrings } from '../common/date-range.util';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';

// Dashboard "Not wired to a backend endpoint yet" panel item #4 — Today's
// expenses. No stock/tank side-effect, no split-payment support (that's a
// Bill-specific pattern, Section 5A — out of scope for a standalone expense
// log). Money-touching: flagged for human review before merge per CLAUDE.md.
@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // recordedById is a plain method arg, never read off the DTO — see
  // ExpensesController, same actor-derivation rule as PurchasesService.create().
  create(dto: CreateExpenseDto, recordedById: string) {
    return this.prisma.expenseEntry.create({
      data: {
        pumpId: requireTenantContext().pumpId,
        category: dto.category.trim(),
        description: dto.description,
        amount: dto.amount,
        paidVia: dto.paidVia,
        recordedById,
        ...(dto.expenseDate !== undefined && {
          expenseDate: parseDateRangeStrings(dto.expenseDate, dto.expenseDate)
            .start,
        }),
      },
    });
  }

  findAll(query: ListExpensesQueryDto) {
    return this.prisma.expenseEntry.findMany({
      where: {
        expenseDate: {
          ...(query.from
            ? { gte: parseDateRangeStrings(query.from, query.from).start }
            : {}),
          ...(query.to
            ? { lte: parseDateRangeStrings(query.to, query.to).end }
            : {}),
        },
      },
      orderBy: { expenseDate: 'desc' },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.expenseEntry.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Expense entry ${id} not found`);
    }
    return this.prisma.expenseEntry.delete({ where: { id } });
  }
}
