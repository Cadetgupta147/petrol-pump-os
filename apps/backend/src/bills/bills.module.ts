import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { CreditConfigModule } from '../credit-config/credit-config.module';

// CreditConfigModule imported for CreditConfigService (Section 3.4A
// enforcement mode + default informal credit limit). CreditAlertsModule is
// NOT imported here — alert creation happens directly via the shared Prisma
// transaction client inside BillsService, not through CreditAlertsService.
@Module({
  imports: [CreditConfigModule],
  controllers: [BillsController],
  providers: [BillsService],
})
export class BillsModule {}
