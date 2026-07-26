import { Module } from '@nestjs/common';
import { UpiWebhookController } from './upi-webhook.controller';
import { UpiWebhookService } from './upi-webhook.service';
import { ShiftSalesModule } from '../shift-sales/shift-sales.module';
import { UpiCaptureConfigModule } from '../upi-capture-config/upi-capture-config.module';

// Section 8A.3 — PhonePe/Paytm UPI webhook. PrismaModule is global (see
// prisma.module.ts), so it needs no import here. ShiftSalesModule is
// imported so UpiWebhookService can call
// ShiftSalesService.incrementUpiForShift() directly (in-process, same
// pattern as BillsModule importing RateMasterModule) rather than
// round-tripping through HTTP. UpiCaptureConfigModule is imported so it can
// resolve which provider/credentials to verify an inbound delivery against
// for a given pumpId (UpiCaptureConfigService.findByPumpId()).
@Module({
  imports: [ShiftSalesModule, UpiCaptureConfigModule],
  controllers: [UpiWebhookController],
  providers: [UpiWebhookService],
})
export class UpiWebhookModule {}
