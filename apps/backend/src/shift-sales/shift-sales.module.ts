import { Module } from '@nestjs/common';
import { ShiftSalesController } from './shift-sales.controller';
import { ShiftSalesService } from './shift-sales.service';
import { RateMasterModule } from '../rate-master/rate-master.module';

// Section 8A.2 — walk-in aggregate sales summary + variance. PrismaModule is
// global (see prisma.module.ts), so no import needed. RateMasterModule is
// imported (and ShiftSalesService exported) so:
//   - this module can resolve the current rate for expectedValue (reusing
//     RateMasterService.getCurrentRate(), same pattern as BillsModule), and
//   - UpiWebhookModule can import THIS module to call
//     ShiftSalesService.incrementUpiForShift() directly (Section 8A.3).
@Module({
  imports: [RateMasterModule],
  controllers: [ShiftSalesController],
  providers: [ShiftSalesService],
  exports: [ShiftSalesService],
})
export class ShiftSalesModule {}
