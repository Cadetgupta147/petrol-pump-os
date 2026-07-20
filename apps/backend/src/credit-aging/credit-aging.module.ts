import { Module } from '@nestjs/common';
import { CreditAgingController } from './credit-aging.controller';
import { CreditAgingService } from './credit-aging.service';

// Section 12 — Credit Aging Report. PrismaModule is global (see
// prisma.module.ts), so no imports needed.
@Module({
  controllers: [CreditAgingController],
  providers: [CreditAgingService],
})
export class CreditAgingModule {}
