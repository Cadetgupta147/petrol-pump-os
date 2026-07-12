import { Module } from '@nestjs/common';
import { CreditAlertsController } from './credit-alerts.controller';
import { CreditAlertsService } from './credit-alerts.service';

@Module({
  controllers: [CreditAlertsController],
  providers: [CreditAlertsService],
})
export class CreditAlertsModule {}
