import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Customer master CRUD — Section 3.4. Outstanding balance is deliberately
// NOT modelled here: it's derived from the bill/payment ledger, which
// doesn't exist yet. No auth/role guards exist in this repo yet either —
// see the RBAC gap called out in the module's final report.
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
        },
      })
      .catch((error) => this.handlePrismaError(error));
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
