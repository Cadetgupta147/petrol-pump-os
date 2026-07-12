import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCreditAlertDto } from './dto/update-credit-alert.dto';

// Section 3.4A — read-only-plus-one-flag. Alerts are only ever created
// internally by BillsService (inside the same transaction as the bill that
// triggered them), so there is deliberately no POST /credit-alerts here.
//
// Auth: enforced at the controller level (global JwtAuthGuard, see
// app.module.ts). Open to any authenticated staff member — per Section 2,
// Accountant's only restrictions are loyalty rates/staff PINs/business
// settings, none of which this touches, so it's not @Roles()-restricted.
@Injectable()
export class CreditAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.creditLimitAlert.findMany({
      include: { bill: true, customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.creditLimitAlert.findUnique({
      where: { id },
      include: { bill: true, customer: true },
    });
    if (!alert) {
      throw new NotFoundException(`CreditLimitAlert ${id} not found`);
    }
    return alert;
  }

  async update(id: string, dto: UpdateCreditAlertDto) {
    // Confirm existence first so a bad id always yields a clean 404.
    await this.findOne(id);

    return this.prisma.creditLimitAlert.update({
      where: { id },
      data: {
        reminderRequested: dto.reminderRequested,
        reminderRequestedAt: new Date(),
      },
      include: { bill: true, customer: true },
    });
  }
}
