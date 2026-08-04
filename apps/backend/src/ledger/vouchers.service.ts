import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DrCr, LedgerGroup, Prisma, SystemLedgerKey, VoucherType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { formatLocalDate, parseDateRangeStrings } from '../common/date-range.util';
import { allocateVoucherNumber } from './voucher-number';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { ListVouchersQueryDto } from './dto/list-vouchers-query.dto';
import { resolveCurrentShiftWindow } from '../shift-schedule/resolve-current-shift-window';

const GROUP_SORT_RANK: Record<string, number> = { CASH_IN_HAND: 0, BANK: 1, SALES: 2 };
const signedDelta = (amount: number, drCr: DrCr) => (drCr === 'DEBIT' ? amount : -amount);

const BALANCE_EPSILON = 0.01;
const balanceShape = (amount: number): { side: 'DR' | 'CR'; amount: number } => ({
  side: amount >= 0 ? 'DR' : 'CR',
  amount: Math.abs(amount),
});

// Shared shape of getDayBook()'s single vouchers.findMany() fetch — both
// buildLedgerView() and buildChronologicalView() consume the exact same
// query result, just grouped/sorted differently.
type DayBookVoucherWithLines = Prisma.VoucherGetPayload<{
  include: { lines: { include: { ledgerAccount: true } } };
}>;

type PaymentModeLabel = 'CASH' | 'CARD' | 'UPI' | 'CREDIT' | 'OTHER';
type DayBookBalance = { side: 'DR' | 'CR'; amount: number };

// Section 12A — Chronological View filters. All three are applied
// in-memory on the already-fetched, already-balance-computed entry list
// (see buildChronologicalView) — never at the vouchers.findMany() query,
// since narrowing that fetch would break the running cash balance chain.
interface ChronologicalFilters {
  voucherType?: VoucherType;
  paymentMode?: PaymentModeLabel;
  partyLedgerAccountId?: string;
}

// Explicit return types (rather than letting TS infer them) so getDayBook()
// can be overloaded below — an overload needs a declared return type per
// signature, TS can't infer per-signature returns from one implementation.
export interface LedgerDayBookReport {
  date: string;
  vouchers: {
    id: string;
    voucherNumber: string;
    date: Date;
    voucherType: string;
    narration: string | null;
    source: string;
    lines: { ledgerAccountName: string; amount: number; drCr: DrCr }[];
  }[];
  ledgers: {
    ledgerAccountId: string;
    name: string;
    group: LedgerGroup;
    openingBalance: DayBookBalance;
    closingBalance: DayBookBalance;
    entries: {
      voucherId: string;
      voucherNumber: string;
      voucherType: string;
      narration: string | null;
      counterpartyNames: string[];
      amount: number;
      drCr: DrCr;
    }[];
  }[];
}

export interface ChronologicalDayBookReport {
  date: string;
  view: 'chronological';
  shifts: {
    shiftDefinitionId: string | null;
    label: string;
    windowStart: Date | null;
    windowEnd: Date | null;
    openingCashBalance: DayBookBalance;
    closingCashBalance: DayBookBalance;
    entries: {
      voucherId: string;
      voucherNumber: string;
      time: Date;
      voucherType: string;
      narration: string | null;
      source: string;
      sourceKey: string | null;
      lines: {
        ledgerAccountId: string;
        ledgerAccountName: string;
        group: LedgerGroup;
        amount: number;
        drCr: DrCr;
      }[];
      paymentMode: PaymentModeLabel;
      partyName: string | null;
      cashDelta: number;
      runningCashBalance: DayBookBalance;
    }[];
  }[];
  cashMismatch: CashMismatchSummary;
}

// Section 12A — the day's cash-handling reconciliation data, surfaced
// AS-IS (not recomputed here). CashCustodyLog already records the DSM's
// physical handover math, and ShiftSalesSummary.variance already records
// expected-vs-collected per shift. This is day-level only — ShiftSalesSummary
// .shiftId is documented as tying back to "the DSM's shift/MeterReading", NOT
// a ShiftDefinition.id — joining it to a specific shift bucket would be a
// guess, so it isn't attempted; both lists are shown flat, independent of
// the day's shift buckets above.
interface CashMismatchSummary {
  cashCustodyLogs: {
    id: string;
    handledById: string;
    handledByName: string;
    totalCashCollected: number;
    depositedToBank: number;
    keptInLocker: number;
    takenHome: number;
    newOutstanding: number;
  }[];
  shiftSalesVariances: {
    id: string;
    shiftId: string;
    dsmId: string;
    nozzleId: string;
    expectedValue: number;
    variance: number;
  }[];
}

// A voucher can touch more than one payment-mode-signalling ledger at once
// (a split-payment Bill posts CASH + CARD_CLEARING + SUNDRY_DEBTOR lines in
// a single voucher) — the Chronological View shows one row per voucher, so
// this picks one representative label by fixed priority. The full picture
// is never lost: each entry's own unfiltered `lines` array still shows every
// leg, this label is just what the row/filter uses.
function derivePaymentMode(
  lines: { ledgerAccount: { systemKey: SystemLedgerKey | null; group: LedgerGroup } }[],
): PaymentModeLabel {
  if (lines.some((l) => l.ledgerAccount.systemKey === 'CASH')) return 'CASH';
  if (lines.some((l) => l.ledgerAccount.systemKey === 'CARD_CLEARING')) return 'CARD';
  if (lines.some((l) => l.ledgerAccount.systemKey === 'UPI_CLEARING')) return 'UPI';
  if (lines.some((l) => l.ledgerAccount.group === 'SUNDRY_DEBTOR' || l.ledgerAccount.group === 'SUNDRY_CREDITOR')) {
    return 'CREDIT';
  }
  return 'OTHER';
}

// The "party" on a voucher is whichever line hit a customer/supplier/staff
// ledger — a real Sundry Debtor/Creditor, or a personal-draw ledger
// (linkedStaffId, e.g. CashCustodyLog's "HOME"/"JACCO" entries). System
// ledgers (Cash, Sales, Purchase, ...) never count as a party.
function derivePartyName(
  lines: {
    ledgerAccount: {
      name: string;
      group: LedgerGroup;
      linkedCustomerId: string | null;
      linkedStaffId: string | null;
    };
  }[],
): string | null {
  const partyLine = lines.find(
    (l) =>
      l.ledgerAccount.group === 'SUNDRY_DEBTOR' ||
      l.ledgerAccount.group === 'SUNDRY_CREDITOR' ||
      l.ledgerAccount.linkedCustomerId !== null ||
      l.ledgerAccount.linkedStaffId !== null,
  );
  return partyLine ? partyLine.ledgerAccount.name : null;
}

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
              narration: line.narration,
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
  async getDayBook(
    dateStr: string | undefined,
    opts: { view: 'chronological' } & ChronologicalFilters,
  ): Promise<ChronologicalDayBookReport>;
  async getDayBook(dateStr?: string, opts?: { view?: 'ledger' }): Promise<LedgerDayBookReport>;
  // Catch-all for call sites (the controller) passing a dynamic/possibly-
  // undefined `view` rather than a literal — the two overloads above are
  // for callers (like the test suite) that know which one they want.
  async getDayBook(
    dateStr?: string,
    opts?: { view?: 'ledger' | 'chronological' } & ChronologicalFilters,
  ): Promise<LedgerDayBookReport | ChronologicalDayBookReport>;
  async getDayBook(
    dateStr?: string,
    opts?: { view?: 'ledger' | 'chronological' } & ChronologicalFilters,
  ): Promise<LedgerDayBookReport | ChronologicalDayBookReport> {
    const date = dateStr ? dateStr.slice(0, 10) : formatLocalDate(new Date());
    const { start, end } = parseDateRangeStrings(date, date);

    // Deliberately NOT filtered by voucherType/paymentMode/party at this
    // query, even for the chronological view — the running cash balance
    // needs every one of the day's vouchers to chain correctly; filtering
    // the fetch itself would silently corrupt it. Filters are applied
    // in-memory, after the balance is computed — see buildChronologicalView.
    const vouchers = await this.prisma.voucher.findMany({
      where: { date: { gte: start, lte: end } },
      include: { lines: { include: { ledgerAccount: true } } },
      orderBy: [{ date: 'asc' }, { voucherNumber: 'asc' }],
    });

    if (opts?.view === 'chronological') {
      return this.buildChronologicalView(date, start, end, vouchers, opts);
    }
    return this.buildLedgerView(date, start, vouchers);
  }

  private async buildLedgerView(
    date: string,
    start: Date,
    vouchers: DayBookVoucherWithLines[],
  ): Promise<LedgerDayBookReport> {
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
          openingBalance: balanceShape(opening),
          closingBalance: balanceShape(closing),
          entries: todaysEntries,
        };
      })
      .sort((a, b) => {
        const rankA = GROUP_SORT_RANK[a.group] ?? 99;
        const rankB = GROUP_SORT_RANK[b.group] ?? 99;
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

  // Section 12A — the Chronological (Shift) View: same day, same
  // Voucher/VoucherLine data as buildLedgerView() above, but grouped by
  // shift and sorted in time order instead of by ledger account. Shift
  // buckets are DERIVED at query time from ShiftDefinition's start/end
  // windows (via resolveCurrentShiftWindow, already built for the shift-
  // schedule module and reused unmodified here) — there is no shiftId
  // column on Voucher, and none is added; a voucher whose timestamp
  // matches no configured window lands in "Unassigned" rather than being
  // forced into one. Note: if a dealer edits/deactivates a ShiftDefinition,
  // past vouchers are re-bucketed against whatever schedule is active NOW
  // when the Day Book is viewed later — ShiftDefinition has no history, and
  // exact boundary precision was never a requirement (see that file's own
  // doc comment), so this is an accepted limitation, not a bug to fix here.
  private async buildChronologicalView(
    date: string,
    start: Date,
    end: Date,
    vouchers: DayBookVoucherWithLines[],
    filters?: ChronologicalFilters,
  ): Promise<ChronologicalDayBookReport> {
    // Cash ledgers are looked up directly (not just ones "touched" today) so
    // a day with zero cash activity still reports a correct, non-zero
    // opening/closing cash figure carried from prior days.
    const [cashLedgers, shiftDefinitions, cashMismatch] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { group: 'CASH_IN_HAND' } }),
      this.prisma.shiftDefinition.findMany({ where: { isActive: true } }),
      this.getCashMismatchSummary(start, end),
    ]);
    const cashLedgerIds = new Set(cashLedgers.map((l) => l.id));

    let runningCash = cashLedgers.reduce(
      (sum, ledger) => sum + signedDelta(ledger.openingBalance, ledger.openingBalanceType),
      0,
    );
    if (cashLedgerIds.size > 0) {
      const priorCashLines = await this.prisma.voucherLine.findMany({
        where: { ledgerAccountId: { in: [...cashLedgerIds] }, voucher: { date: { lt: start } } },
        select: { amount: true, drCr: true },
      });
      for (const line of priorCashLines) {
        runningCash += signedDelta(line.amount, line.drCr);
      }
    }

    type ChronoEntry = {
      voucherId: string;
      voucherNumber: string;
      time: Date;
      voucherType: string;
      narration: string | null;
      source: string;
      sourceKey: string | null;
      lines: {
        ledgerAccountId: string;
        ledgerAccountName: string;
        group: LedgerGroup;
        amount: number;
        drCr: DrCr;
      }[];
      paymentMode: PaymentModeLabel;
      partyName: string | null;
      cashDelta: number;
      runningCashBalanceBefore: number;
      runningCashBalanceAfter: number;
    };

    // `vouchers` is already ordered by date asc (voucherNumber as tiebreak —
    // see getDayBook()'s query), so a single pass in array order is already
    // a correct time-ordered pass. One caveat: MANUAL vouchers store `date`
    // as midnight (VouchersService.create() truncates to the calendar date,
    // no time-of-day is ever collected for them), so a manual entry always
    // sorts to the start of the day regardless of when it was actually
    // keyed in — an accepted quirk of manual entry, not something this view
    // can recover time-of-day for.
    const entries: ChronoEntry[] = vouchers.map((voucher) => {
      const before = runningCash;
      const cashDelta = voucher.lines
        .filter((l) => cashLedgerIds.has(l.ledgerAccountId))
        .reduce((sum, l) => sum + signedDelta(l.amount, l.drCr), 0);
      runningCash += cashDelta;
      return {
        voucherId: voucher.id,
        voucherNumber: voucher.voucherNumber,
        time: voucher.date,
        voucherType: voucher.voucherType,
        narration: voucher.narration,
        source: voucher.source,
        sourceKey: voucher.sourceKey,
        lines: voucher.lines.map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          ledgerAccountName: l.ledgerAccount.name,
          group: l.ledgerAccount.group,
          amount: l.amount,
          drCr: l.drCr,
        })),
        paymentMode: derivePaymentMode(voucher.lines),
        partyName: derivePartyName(voucher.lines),
        cashDelta,
        runningCashBalanceBefore: before,
        runningCashBalanceAfter: runningCash,
      };
    });

    // Filters narrow which entries are DISPLAYED — they never touch
    // `entries` before this point, so runningCashBalanceBefore/After above
    // always reflect the true, complete day, regardless of what's filtered
    // out here. Applied on the flat list, before bucketing, so a shift with
    // no entries left after filtering simply produces no bucket for itself
    // rather than an empty one.
    const filteredEntries = entries.filter((entry) => {
      if (filters?.voucherType && entry.voucherType !== filters.voucherType) return false;
      if (filters?.paymentMode && entry.paymentMode !== filters.paymentMode) return false;
      if (
        filters?.partyLedgerAccountId &&
        !entry.lines.some((l) => l.ledgerAccountId === filters.partyLedgerAccountId)
      ) {
        return false;
      }
      return true;
    });

    type ShiftBucket = {
      shiftDefinitionId: string | null;
      label: string;
      windowStart: Date | null;
      windowEnd: Date | null;
      entries: ChronoEntry[];
    };
    const bucketsByKey = new Map<string, ShiftBucket>();
    for (const entry of filteredEntries) {
      const resolved = resolveCurrentShiftWindow(shiftDefinitions, entry.time);
      const key = resolved ? resolved.shiftDefinition.id : 'UNASSIGNED';
      if (!bucketsByKey.has(key)) {
        bucketsByKey.set(key, {
          shiftDefinitionId: resolved ? resolved.shiftDefinition.id : null,
          label: resolved ? resolved.shiftDefinition.label : 'Unassigned',
          windowStart: resolved ? resolved.windowStart : null,
          windowEnd: resolved ? resolved.windowEnd : null,
          entries: [],
        });
      }
      bucketsByKey.get(key)!.entries.push(entry);
    }

    const shifts = [...bucketsByKey.values()]
      .sort((a, b) => {
        if (!a.windowStart && !b.windowStart) return 0;
        if (!a.windowStart) return 1;
        if (!b.windowStart) return -1;
        return a.windowStart.getTime() - b.windowStart.getTime();
      })
      .map((bucket) => ({
        shiftDefinitionId: bucket.shiftDefinitionId,
        label: bucket.label,
        windowStart: bucket.windowStart,
        windowEnd: bucket.windowEnd,
        openingCashBalance: balanceShape(bucket.entries[0].runningCashBalanceBefore),
        closingCashBalance: balanceShape(
          bucket.entries[bucket.entries.length - 1].runningCashBalanceAfter,
        ),
        entries: bucket.entries.map((entry) => ({
          voucherId: entry.voucherId,
          voucherNumber: entry.voucherNumber,
          time: entry.time,
          voucherType: entry.voucherType,
          narration: entry.narration,
          source: entry.source,
          sourceKey: entry.sourceKey,
          lines: entry.lines,
          paymentMode: entry.paymentMode,
          partyName: entry.partyName,
          cashDelta: entry.cashDelta,
          runningCashBalance: balanceShape(entry.runningCashBalanceAfter),
        })),
      }));

    return { date, view: 'chronological' as const, shifts, cashMismatch };
  }

  // Section 12A — day-scoped, not shift-bucket-scoped (see
  // CashMismatchSummary's doc comment for why). CashCustodyLog is scoped by
  // its own `date` field; ShiftSalesSummary has no `date` column, so
  // `createdAt` is used instead — the same day-range this whole view is
  // already computed against.
  private async getCashMismatchSummary(start: Date, end: Date): Promise<CashMismatchSummary> {
    const [cashCustodyLogs, shiftSalesSummaries] = await Promise.all([
      this.prisma.cashCustodyLog.findMany({
        where: { date: { gte: start, lte: end } },
        include: { handledBy: { select: { name: true } } },
      }),
      this.prisma.shiftSalesSummary.findMany({
        where: { createdAt: { gte: start, lte: end } },
      }),
    ]);

    return {
      cashCustodyLogs: cashCustodyLogs.map((log) => ({
        id: log.id,
        handledById: log.handledById,
        handledByName: log.handledBy.name,
        totalCashCollected: log.totalCashCollected,
        depositedToBank: log.depositedToBank,
        keptInLocker: log.keptInLocker,
        takenHome: log.takenHome,
        newOutstanding: log.newOutstanding,
      })),
      shiftSalesVariances: shiftSalesSummaries.map((s) => ({
        id: s.id,
        shiftId: s.shiftId,
        dsmId: s.dsmId,
        nozzleId: s.nozzleId,
        expectedValue: s.expectedValue,
        variance: s.variance,
      })),
    };
  }

  // Section 12 fix (docs/ledger-accounting-review.md finding #8) — every
  // active ledger's running balance as of a date, not just ones touched on
  // one specific day like the Day Book above. Generalizes the same opening-
  // balance math (ledger's own openingBalance/openingBalanceType, plus every
  // VoucherLine dated on-or-before `asOf`) into a single running balance per
  // ledger rather than a same-day opening/closing pair.
  async getTrialBalance(asOfStr?: string) {
    const asOf = asOfStr ? asOfStr.slice(0, 10) : formatLocalDate(new Date());
    const { end } = parseDateRangeStrings(asOf, asOf);

    const [ledgerAccounts, lines] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { isActive: true } }),
      this.prisma.voucherLine.findMany({
        where: { voucher: { date: { lte: end } } },
        select: { ledgerAccountId: true, amount: true, drCr: true },
      }),
    ]);

    const balanceByLedger = new Map<string, number>();
    for (const ledger of ledgerAccounts) {
      balanceByLedger.set(ledger.id, signedDelta(ledger.openingBalance, ledger.openingBalanceType));
    }
    for (const line of lines) {
      if (!balanceByLedger.has(line.ledgerAccountId)) continue;
      balanceByLedger.set(
        line.ledgerAccountId,
        (balanceByLedger.get(line.ledgerAccountId) ?? 0) + signedDelta(line.amount, line.drCr),
      );
    }

    const rows = ledgerAccounts
      .map((ledger) => {
        const balance = balanceByLedger.get(ledger.id) ?? 0;
        return {
          ledgerAccountId: ledger.id,
          name: ledger.name,
          group: ledger.group,
          balance: { side: (balance >= 0 ? 'DR' : 'CR') as 'DR' | 'CR', amount: Math.abs(balance) },
        };
      })
      .sort((a, b) => {
        const rankA = GROUP_SORT_RANK[a.group] ?? 99;
        const rankB = GROUP_SORT_RANK[b.group] ?? 99;
        return rankA !== rankB ? rankA - rankB : a.name.localeCompare(b.name);
      });

    const totals = rows.reduce(
      (acc, row) => {
        if (row.balance.side === 'DR') acc.dr += row.balance.amount;
        else acc.cr += row.balance.amount;
        return acc;
      },
      { dr: 0, cr: 0 },
    );

    return { asOf, rows, totals };
  }
}
