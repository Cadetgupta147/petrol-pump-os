import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SetLoyaltyRateOverrideDto } from './dto/set-loyalty-rate-override.dto';
import { allocateQrMemberId } from './member-id';

// Customer master CRUD + ledger — Section 3.4. Outstanding balance is
// deliberately NOT stored on Customer: it's derived on read from the
// bill/payment ledger (see ledger() below). Auth/role guards do exist and
// apply here: the global JwtAuthGuard (app.module.ts) requires a valid JWT
// on every route, and CustomersController carries
// @Roles(Role.OWNER, Role.ACCOUNTANT), enforced by the global RolesGuard.
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCustomerDto) {
    // Member id allocation + customer create share one transaction so a
    // failed create (e.g. duplicate phone) rolls the counter increment back
    // — no burned sequence numbers (Section 6.1/6.7, see member-id.ts).
    return this.prisma
      .$transaction(async (tx) => {
        const qrMemberId = await allocateQrMemberId(tx);
        return tx.customer.create({
          data: {
            name: dto.name,
            phone: dto.phone,
            vehicleNumber: dto.vehicleNumber,
            creditLimit: dto.creditLimit ?? 0,
            qrMemberId,
          },
        });
      })
      .catch((error) => this.handlePrismaError(error));
  }

  findAll() {
    return this.prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    // Confirm existence first so a bad id always yields a clean 404, not a
    // Prisma P2025 translated into a generic error.
    await this.findOne(id);

    return this.prisma.customer
      .update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.vehicleNumber !== undefined && {
            vehicleNumber: dto.vehicleNumber,
          }),
          ...(dto.creditLimit !== undefined && {
            creditLimit: dto.creditLimit,
          }),
          // Section 3.4A — the "upgrade informal -> verified" path.
          ...(dto.verificationStatus !== undefined && {
            verificationStatus: dto.verificationStatus,
          }),
        },
      })
      .catch((error) => this.handlePrismaError(error));
  }

  // Section 6.1 — the QR card payload. The QR encodes ONLY qrMemberId (a
  // pointer, not a wallet): no name, no phone, no points balance, no rate.
  // Everything else is looked up server-side when the QR is scanned, so
  // rate/balance changes never require reprinting a card, and a QR scanned
  // outside this system resolves to nothing.
  async qrCard(id: string) {
    const customer = await this.findOne(id);
    const payload = customer.qrMemberId;

    const [pngDataUrl, svg] = await Promise.all([
      // PNG data URL for on-screen display in the web portal.
      QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
      }),
      // SVG for print — Section 6.7's laminated PVC card wants a
      // resolution-independent source.
      QRCode.toString(payload, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      }),
    ]);

    return {
      customerId: customer.id,
      qrMemberId: payload,
      // Name + vehicle are returned for the printed card's human-readable
      // caption (Section 14's card mockup) — they are NOT inside the QR.
      name: customer.name,
      vehicleNumber: customer.vehicleNumber,
      pngDataUrl,
      svg,
    };
  }

  // Section 6.2 — per-customer earning rate override (rate precedence step
  // 1). null clears the override; 0 is a real override meaning "earns
  // nothing". Owner-only at the controller.
  async setLoyaltyRateOverride(id: string, dto: SetLoyaltyRateOverrideDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: { loyaltyRateOverride: dto.loyaltyRateOverride },
    });
  }

  // Section 3.4 — full ledger per customer: every bill, every payment,
  // running balance. Works identically for informal and verified customers
  // (no special-casing) and naturally reflects bills created via quick-add
  // in the same request cycle, since it queries by customerId fresh rather
  // than relying on any pre-fetched/cached customer or bill list.
  async ledger(id: string) {
    const customer = await this.findOne(id);

    const [bills, payments] = await Promise.all([
      this.prisma.bill.findMany({
        where: { customerId: id, deletedAt: null },
        include: { paymentLines: true },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    type LedgerEntry = {
      type: 'BILL' | 'PAYMENT';
      id: string;
      timestamp: Date;
      netCreditImpact: number;
      runningBalance: number;
      data: unknown;
    };

    const billEntries: LedgerEntry[] = bills.map((bill) => {
      const creditIn = bill.paymentLines
        .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'IN')
        .reduce((total, line) => total + line.amount, 0);
      const creditOut = bill.paymentLines
        .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'OUT')
        .reduce((total, line) => total + line.amount, 0);
      return {
        type: 'BILL',
        id: bill.id,
        timestamp: bill.timestamp,
        netCreditImpact: creditIn - creditOut,
        runningBalance: 0, // filled in below during the chronological walk
        data: bill,
      };
    });

    const paymentEntries: LedgerEntry[] = payments.map((payment) => ({
      type: 'PAYMENT',
      id: payment.id,
      timestamp: payment.createdAt,
      netCreditImpact: -payment.amount,
      runningBalance: 0,
      data: payment,
    }));

    const merged = [...billEntries, ...paymentEntries].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    let runningBalance = 0;
    for (const entry of merged) {
      runningBalance += entry.netCreditImpact;
      entry.runningBalance = runningBalance;
    }

    return {
      customer,
      entries: merged,
      outstandingBalance: runningBalance,
      creditLimit: customer.creditLimit,
    };
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A customer with this phone number already exists',
      );
    }
    throw error;
  }
}
