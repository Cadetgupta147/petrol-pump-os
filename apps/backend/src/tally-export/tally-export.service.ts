import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ExportRangeDto } from './dto/export-range.dto';
import {
  BillForExport,
  PaymentForExport,
  buildTallyExportXml,
} from './tally-xml-builder.util';

const DEFAULT_COMPANY_NAME = 'Petrol Pump OS';

// Section 10 — Tally XML export. Only Bill and Payment records feed this
// export (Section 10.2's mapping list restricted to what was actually
// asked for this round); walk-in sales captured only in ShiftSalesSummary
// and PurchaseEntry -> Purchase Voucher are explicitly out of scope — see
// the task spec / follow-up note in the PR description.
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
    try {
      const [bills, payments] = await Promise.all([
        this.prisma.bill.findMany({
          where: { deletedAt: null, timestamp: { gte: start, lte: end } },
          include: { paymentLines: true, customer: true },
        }),
        this.prisma.payment.findMany({
          where: { createdAt: { gte: start, lte: end } },
          include: { customer: true },
        }),
      ]);

      const billInputs: BillForExport[] = bills.map((bill) => ({
        id: bill.id,
        timestamp: bill.timestamp,
        amount: bill.amount,
        customerName: bill.customerName,
        vehicleNumber: bill.vehicleNumber,
        customer: bill.customer
          ? { id: bill.customer.id, name: bill.customer.name }
          : null,
        paymentLines: bill.paymentLines.map((line) => ({
          paymentType: line.paymentType,
          amount: line.amount,
          direction: line.direction,
        })),
      }));

      const paymentInputs: PaymentForExport[] = payments.map((payment) => ({
        id: payment.id,
        createdAt: payment.createdAt,
        amount: payment.amount,
        method: payment.method,
        customer: { id: payment.customer.id, name: payment.customer.name },
      }));

      recordCount = billInputs.length + paymentInputs.length;

      const xml = buildTallyExportXml({
        companyName,
        bills: billInputs,
        payments: paymentInputs,
      });

      await this.prisma.tallyExportLog.create({
        data: {
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
