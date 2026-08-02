import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { LedgerModule } from '../ledger/ledger.module';
import { CustomersModule } from '../customers/customers.module';

// PrismaModule is global (see prisma.module.ts). LedgerModule for the
// auto-posted RECEIPT voucher (Section 12); CustomersModule for
// CustomersService.findOne() (tenant-scoped existence check + display name).
@Module({
  imports: [LedgerModule, CustomersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
