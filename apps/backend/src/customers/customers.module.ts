import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

// CustomersService is exported so CustomerPortalModule can reuse
// ledger()'s outstandingBalance derivation for GET /customer-portal/me —
// one source of truth for this money-touching calculation (CLAUDE.md),
// rather than a second, potentially-divergent copy.
@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
