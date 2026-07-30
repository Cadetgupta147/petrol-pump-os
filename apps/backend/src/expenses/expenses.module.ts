import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { LedgerModule } from '../ledger/ledger.module';

// PrismaModule is global (see prisma.module.ts), so no imports needed
// besides LedgerModule (Section 12 — auto-posts a ledger voucher per cash
// expense, see LedgerPostingService).
@Module({
  imports: [LedgerModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
