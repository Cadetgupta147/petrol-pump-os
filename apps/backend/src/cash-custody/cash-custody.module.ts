import { Module } from '@nestjs/common';
import { CashCustodyController } from './cash-custody.controller';
import { CashCustodyService } from './cash-custody.service';

// Section 8 — Day-End Cash Reconciliation & Custody. PrismaModule is global
// (see prisma.module.ts), so no imports needed.
@Module({
  controllers: [CashCustodyController],
  providers: [CashCustodyService],
})
export class CashCustodyModule {}
