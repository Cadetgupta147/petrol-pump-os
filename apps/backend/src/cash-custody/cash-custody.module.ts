import { Module } from '@nestjs/common';
import { CashCustodyController } from './cash-custody.controller';
import { CashCustodyService } from './cash-custody.service';
import { LedgerModule } from '../ledger/ledger.module';

// Section 8 — Day-End Cash Reconciliation & Custody. PrismaModule is global
// (see prisma.module.ts), so no imports needed besides LedgerModule
// (Section 12 — auto-posts a contra voucher per day-end entry, see
// LedgerPostingService).
@Module({
  imports: [LedgerModule],
  controllers: [CashCustodyController],
  providers: [CashCustodyService],
})
export class CashCustodyModule {}
