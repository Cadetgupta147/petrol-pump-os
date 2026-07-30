import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DrCr } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { formatLocalDate, parseDateRangeStrings } from '../common/date-range.util';
import { allocateVoucherNumber } from './voucher-number';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { ListVouchersQueryDto } from './dto/list-vouchers-query.dto';

const BALANCE_EPSILON = 0.01;

// Manual voucher entry (Payment/Receipt/Contra/Journal) — Section 12 Day
// Book. This is the "owner sets it up themselves" half of the ledger design
// (LedgerPostingService is the auto-posted half) — see that service's
// header comment for the split.
@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  // Section 12 — money-handling logic (CLAUDE.md: rule-heavy double-entry
  // math needs a human-review flag before merge, same as CashCustodyLog's
  // 3-way split). Enforced server-side per CLAUDE.md — never rely on a
  // frontend "Save" button being disabled.
  async create(dto: CreateVoucherDto, createdById: string) {
    const debitTotal = dto.lines
      .filter((l) => l.drCr === 'DEBIT')
      .reduce((sum, l) => sum + l.amount, 0);
    const creditTotal = dto.lines
      .filter((l) => l.drCr === 'CREDIT')
      .reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(debitTotal - creditTotal) > BALANCE_EPSILON) {
      throw new BadRequestException(
        `Voucher does not balance: total debits (${debitTotal.toFixed(2)}) must equal total credits (${creditTotal.toFixed(2)}).`,
      );
    }

    const pumpId = requireTenantContext().pumpId;
    const ledgerIds = [...new Set(dto.lines.map((l) => l.ledgerAccountId))];
    const ledgers = await this.prisma.ledgerAccount.findMany({
      where: { id: { in: ledgerIds }, pumpId },
    });
    if (ledgers.length !== ledgerIds.length) {
      throw new BadRequestException('One or more ledger accounts do not exist for this pump.');
    }
    const inactive = ledgers.find((l) => !l.isActive);
    if (inactive) {
      throw new BadRequestException(`Ledger account "${inactive.name}" is inactive.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const voucherNumber = await allocateVoucherNumber(tx, pumpId);
      return tx.voucher.create({
        data: {
          pumpId,
          voucherNumber,
          date: parseDateRangeStrings(dto.date, dto.date).start,
          voucherType: dto.voucherType,
          narration: dto.narration,
          source: 'MANUAL',
          createdById,
          lines: {
            create: dto.lines.map((line) => ({
              pumpId,
              ledgerAccountId: line.ledgerAccountId,
              amount: line.amount,
              drCr: line.drCr,
            })),
          },
        },
        include: { lines: { include: { ledgerAccount: true } } },
      });
    });
  }

  findAll(query: ListVouchersQueryDto) {
    return this.prisma.voucher.findMany({
      where: {
        ...(query.from || query.to
          ? {
              date: {
                ...(query.from ? { gte: parseDateRangeStrings(query.from, query.from).start } : {}),
                ...(query.to ? { lte: parseDateRangeStrings(query.to, query.to).end } : {}),
              },
            }
          : {}),
        ...(query.ledgerAccountId
          ? { lines: { some: { ledgerAccountId: query.ledgerAccountId } } }
          : {}),
      },
      include: { lines: { include: { ledgerAccount: true } }, createdBy: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id },
      include: { lines: { include: { ledgerAccount: true } }, createdBy: { select: { name: true } } },
    });
    if (!voucher) {
      throw new NotFoundException(`Voucher ${id} not found`);
    }
    return voucher;
  }

  // Only MANUAL vouchers can be deleted — an auto-posted one must stay in
  // lockstep with the Bill/ExpenseEntry/CashCustodyLog/ShiftSalesSummary row
  // that generated it (LedgerPostingService owns its lifecycle); deleting it
  // here would desync the ledger from its source of truth with no way to
  // regenerate it. No edit endpoint either (v1 scope) — a wrong manual entry
  // is corrected by deleting and re-entering, same append-only-by-default
  // philosophy as CashCustodyLog.
  async remove(id: string) {
    const voucher = await this.findOne(id);
    if (voucher.source !== 'MANUAL') {
      throw new BadRequestException(
        `Voucher ${voucher.voucherNumber} was auto-posted from a ${voucher.source} record and cannot be deleted directly — correct or delete the source record instead.`,
      );
    }
    await this.prisma.voucher.delete({ where: { id } });
    return { deleted: true };
  }

  // Section 12 — the actual Day Book: every ledger touched on the given
  // date, each with an opening balance (as of just before that date),
  // the day's entries against it (with the OTHER leg(s) of the same
  // voucher shown as "particulars", same convention as the dealer's Tally
  // printout), and a closing balance — plus a flat chronological voucher
  // list (the "vanilla" Day Book view). Every touched ledger gets a
  // section, not just Cash/Bank/Sales — sorted so those three come first
  // since they're the ones a dealer expects to see up top, then the rest
  // alphabetically.
  async getDayBook(dateStr?: string) {
    const date = dateStr ? dateStr.slice(0, 10) : formatLocalDate(new Date());
    const { start, end } = parseDateRangeStrings(date, date);

    const vouchers = await this.prisma.voucher.findMany({
      where: { date: { gte: start, lte: end } },
      include: { lines: { include: { ledgerAccount: true } } },
      orderBy: [{ date: 'asc' }, { voucherNumber: 'asc' }],
    });

    const touchedLedgerIds = [
      ...new Set(vouchers.flatMap((v) => v.lines.map((l) => l.ledgerAccountId))),
    ];

    if (touchedLedgerIds.length === 0) {
      return { date, vouchers: [], ledgers: [] };
    }

    const [ledgerAccounts, priorLines] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { id: { in: touchedLedgerIds } } }),
      this.prisma.voucherLine.findMany({
        where: { ledgerAccountId: { in: touchedLedgerIds }, voucher: { date: { lt: start } } },
        select: { ledgerAccountId: true, amount: true, drCr: true },
      }),
    ]);

    const signedDelta = (amount: number, drCr: DrCr) => (drCr === 'DEBIT' ? amount : -amount);

    const openingByLedger = new Map<string, number>();
    for (const ledger of ledgerAccounts) {
      openingByLedger.set(
        ledger.id,
        signedDelta(ledger.openingBalance, ledger.openingBalanceType),
      );
    }
    for (const line of priorLines) {
      openingByLedger.set(
        line.ledgerAccountId,
        (openingByLedger.get(line.ledgerAccountId) ?? 0) + signedDelta(line.amount, line.drCr),
      );
    }

    type LedgerEntry = {
      voucherId: string;
      voucherNumber: string;
      voucherType: string;
      narration: string | null;
      counterpartyNames: string[];
      amount: number;
      drCr: DrCr;
    };
    const entriesByLedger = new Map<string, LedgerEntry[]>();
    for (const ledgerId of touchedLedgerIds) {
      entriesByLedger.set(ledgerId, []);
    }
    for (const voucher of vouchers) {
      for (const line of voucher.lines) {
        const counterpartyNames = voucher.lines
          .filter((other) => other.id !== line.id)
          .map((other) => other.ledgerAccount.name);
        entriesByLedger.get(line.ledgerAccountId)!.push({
          voucherId: voucher.id,
          voucherNumber: voucher.voucherNumber,
          voucherType: voucher.voucherType,
          narration: voucher.narration,
          counterpartyNames,
          amount: line.amount,
          drCr: line.drCr,
        });
      }
    }

    const groupSortRank: Record<string, number> = { CASH_IN_HAND: 0, BANK: 1, SALES: 2 };
    const ledgers = ledgerAccounts
      .map((ledger) => {
        const opening = openingByLedger.get(ledger.id) ?? 0;
        const todaysEntries = entriesByLedger.get(ledger.id) ?? [];
        const closing = todaysEntries.reduce(
          (running, entry) => running + signedDelta(entry.amount, entry.drCr),
          opening,
        );
        return {
          ledgerAccountId: ledger.id,
          name: ledger.name,
          group: ledger.group,
          openingBalance: { side: opening >= 0 ? 'DR' : 'CR', amount: Math.abs(opening) },
          closingBalance: { side: closing >= 0 ? 'DR' : 'CR', amount: Math.abs(closing) },
          entries: todaysEntries,
        };
      })
      .sort((a, b) => {
        const rankA = groupSortRank[a.group] ?? 99;
        const rankB = groupSortRank[b.group] ?? 99;
        return rankA !== rankB ? rankA - rankB : a.name.localeCompare(b.name);
      });

    return {
      date,
      vouchers: vouchers.map((v) => ({
        id: v.id,
        voucherNumber: v.voucherNumber,
        date: v.date,
        voucherType: v.voucherType,
        narration: v.narration,
        source: v.source,
        lines: v.lines.map((l) => ({
          ledgerAccountName: l.ledgerAccount.name,
          amount: l.amount,
          drCr: l.drCr,
        })),
      })),
      ledgers,
    };
  }
}
