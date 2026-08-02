import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { ExportRangeDto } from './dto/export-range.dto';
import {
  LedgerAccountForExport,
  VoucherForExport,
  buildTallyExportXml,
} from './tally-xml-builder.util';

const DEFAULT_COMPANY_NAME = 'Petrol Pump OS';

// Section 10 — Tally XML export (Section 12 fix, docs/ledger-accounting-
// review.md finding #4). Reads the SAME LedgerAccount/Voucher/VoucherLine
// tables the Day Book reads, not Bill/Payment directly — every source that
// posts to the ledger (Bills, Expenses, Cash Custody, Shift Sales, manual
// Voucher Entry, Purchases) is exported, with no per-source-type mapping
// code needed here. Every active ledger is included as a master regardless
// of whether it was touched in this date range, so importing a later period
// never references an unknown ledger.
@Injectable()
export class TallyExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async generateXml(
    dto: ExportRangeDto,
  ): Promise<{ xml: string; filename: string }> {
    const { start, end } = parseDateRange(dto);
    const companyName =
      this.config.get<string>('TALLY_COMPANY_NAME') ?? DEFAULT_COMPANY_NAME;

    let recordCount = 0;
    const pumpId = requireTenantContext().pumpId;
    try {
      const [ledgerAccounts, vouchers] = await Promise.all([
        this.prisma.ledgerAccount.findMany({
          where: { isActive: true },
        }),
        this.prisma.voucher.findMany({
          where: { date: { gte: start, lte: end } },
          include: { lines: { include: { ledgerAccount: true } } },
          orderBy: [{ date: 'asc' }, { voucherNumber: 'asc' }],
        }),
      ]);

      const ledgerAccountInputs: LedgerAccountForExport[] = ledgerAccounts.map((account) => ({
        name: account.name,
        group: account.group,
        openingBalance: account.openingBalance,
        openingBalanceType: account.openingBalanceType,
      }));

      const voucherInputs: VoucherForExport[] = vouchers.map((voucher) => ({
        voucherNumber: voucher.voucherNumber,
        date: voucher.date,
        voucherType: voucher.voucherType,
        narration: voucher.narration,
        lines: voucher.lines.map((line) => ({
          ledgerAccountName: line.ledgerAccount.name,
          amount: line.amount,
          drCr: line.drCr,
          narration: line.narration,
        })),
      }));

      recordCount = voucherInputs.length;

      const xml = buildTallyExportXml({
        companyName,
        ledgerAccounts: ledgerAccountInputs,
        vouchers: voucherInputs,
      });

      await this.prisma.tallyExportLog.create({
        data: {
          pumpId,
          format: 'xml',
          recordCount,
          status: 'success',
          dateRangeFrom: start,
          dateRangeTo: end,
        },
      });

      const filename = `tally-export-${dto.from}-${dto.to}.xml`;
      return { xml, filename };
    } catch (error) {
      await this.prisma.tallyExportLog.create({
        data: {
          pumpId,
          format: 'xml',
          recordCount,
          status: 'failed',
          dateRangeFrom: start,
          dateRangeTo: end,
        },
      });
      throw error;
    }
  }
}

// dto.from / dto.to are validated (@IsDateString) as YYYY-MM-DD (a full ISO
// datetime also passes validation, so only the first 10 chars are read
// here). Constructs local-calendar start-of-day / end-of-day boundaries,
// same convention as dashboard.service.ts's getStartAndEndOfToday().
function parseDateRange(dto: ExportRangeDto): { start: Date; end: Date } {
  const [fromYear, fromMonth, fromDay] = dto.from
    .slice(0, 10)
    .split('-')
    .map(Number);
  const [toYear, toMonth, toDay] = dto.to.slice(0, 10).split('-').map(Number);

  const start = new Date(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0);
  const end = new Date(toYear, toMonth - 1, toDay, 23, 59, 59, 999);
  return { start, end };
}
