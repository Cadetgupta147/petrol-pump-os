import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { LedgerModule } from '../ledger/ledger.module';

// CustomersService is exported so CustomerPortalModule can reuse
// ledger()'s outstandingBalance derivation for GET /customer-portal/me —
// one source of truth for this money-touching calculation (CLAUDE.md),
// rather than a second, potentially-divergent copy.
// Section 12 fix — LedgerModule imported so addOpeningBalance() can post a
// correcting voucher when a customer's ledger already has history (see
// LedgerPostingService.postOpeningBalanceAdjustment()).
@Module({
  imports: [LedgerModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
