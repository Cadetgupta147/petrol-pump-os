import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import { UpdateLedgerAccountDto } from './dto/update-ledger-account.dto';

// Ledger Master (Section 12 Day Book) — CRUD over dealer-created account
// heads. System-managed ledgers (Cash, Sales, per-customer/per-staff, …)
// are never created or deleted here — only ever by
// LedgerPostingService's get-or-create helpers — but their name/opening
// balance can still be edited here (see UpdateLedgerAccountDto's comment).
@Injectable()
export class LedgerAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateLedgerAccountDto) {
    try {
      return this.prisma.ledgerAccount.create({
        data: {
          pumpId: requireTenantContext().pumpId,
          name: dto.name.trim(),
          group: dto.group,
          openingBalance: dto.openingBalance ?? 0,
          openingBalanceType: dto.openingBalanceType ?? 'DEBIT',
          isSystemManaged: false,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, dto.name);
    }
  }

  findAll() {
    return this.prisma.ledgerAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isSystemManaged: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { id } });
    if (!account) {
      throw new NotFoundException(`LedgerAccount ${id} not found`);
    }
    return account;
  }

  async update(id: string, dto: UpdateLedgerAccountDto) {
    const existing = await this.findOne(id);
    // Changing GROUP on a system-managed ledger would misrepresent it on
    // every report that reads LedgerGroup (e.g. the system Sales ledger
    // silently becoming a SUNDRY_CREDITOR) — name/opening balance stay
    // editable (see UpdateLedgerAccountDto's comment), group does not.
    if (existing.isSystemManaged && dto.group !== undefined && dto.group !== existing.group) {
      throw new BadRequestException(
        `${existing.name} is a system-managed ledger — its group cannot be changed (only name and opening balance can).`,
      );
    }
    try {
      return await this.prisma.ledgerAccount.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.group !== undefined && { group: dto.group }),
          ...(dto.openingBalance !== undefined && { openingBalance: dto.openingBalance }),
          ...(dto.openingBalanceType !== undefined && {
            openingBalanceType: dto.openingBalanceType,
          }),
        },
      });
    } catch (error) {
      this.handlePrismaError(error, dto.name ?? existing.name);
    }
  }

  // Soft-delete (isActive: false) rather than a hard DELETE — a ledger with
  // even one VoucherLine against it must stay resolvable (the Day Book and
  // every past voucher still need to show its name), so the row can never
  // actually be removed once used. findAll()/day-book keep filtering it out
  // of future use via isActive.
  async remove(id: string) {
    const existing = await this.findOne(id);
    if (existing.isSystemManaged) {
      throw new BadRequestException(
        `${existing.name} is a system-managed ledger and cannot be deleted — auto-posting depends on it existing.`,
      );
    }
    const lineCount = await this.prisma.voucherLine.count({
      where: { ledgerAccountId: id },
    });
    if (lineCount > 0) {
      throw new BadRequestException(
        `${existing.name} has ${lineCount} voucher line(s) posted against it and cannot be deleted — deactivate is the only option once a ledger has been used.`,
      );
    }
    return this.prisma.ledgerAccount.update({ where: { id }, data: { isActive: false } });
  }

  private handlePrismaError(error: unknown, name: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new BadRequestException(`A ledger account named "${name}" already exists.`);
    }
    throw error;
  }
}
