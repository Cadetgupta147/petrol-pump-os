import { Module } from '@nestjs/common';
import { LedgerAccountsController } from './ledger-accounts.controller';
import { LedgerAccountsService } from './ledger-accounts.service';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { LedgerPostingService } from './ledger-posting.service';

// Section 12 — Ledger / Day Book. LedgerPostingService is exported so
// BillsModule/ExpensesModule/CashCustodyModule/ShiftSalesModule can inject
// it directly (best-effort auto-posting — see that service's header
// comment). PrismaModule is global, so no import needed here.
@Module({
  controllers: [LedgerAccountsController, VouchersController],
  providers: [LedgerAccountsService, VouchersService, LedgerPostingService],
  exports: [LedgerPostingService],
})
export class LedgerModule {}
