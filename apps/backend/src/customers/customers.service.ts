import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Customer master CRUD + ledger — Section 3.4. Outstanding balance is
// deliberately NOT stored on Customer: it's derived on read from the
// bill/payment ledger (see ledger() below). No auth/role guards exist in
// this repo yet either — see the RBAC gap called out in the module's final
// report.
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCustomerDto) {
    return this.prisma.customer
      .create({
        data: {
          name: dto.name,
          phone: dto.phone,
          vehicleNumber: dto.vehicleNumber,
          creditLimit: dto.creditLimit ?? 0,
        },
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
