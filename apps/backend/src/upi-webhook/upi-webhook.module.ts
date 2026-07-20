import { Module } from '@nestjs/common';
import { UpiWebhookController } from './upi-webhook.controller';
import { UpiWebhookService } from './upi-webhook.service';
import { ShiftSalesModule } from '../shift-sales/shift-sales.module';

// Section 8A.3 — PhonePe/Paytm UPI webhook. PrismaModule is global (see
// prisma.module.ts); ConfigModule is global too (see app.module.ts), so
// neither needs importing here. ShiftSalesModule is imported so
// UpiWebhookService can call ShiftSalesService.incrementUpiForShift()
// directly (in-process, same pattern as BillsModule importing
// RateMasterModule) rather than round-tripping through HTTP.
@Module({
  imports: [ShiftSalesModule],
  controllers: [UpiWebhookController],
  providers: [UpiWebhookService],
})
export class UpiWebhookModule {}
