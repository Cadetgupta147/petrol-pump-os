import { Module } from '@nestjs/common';
import { ShiftScheduleController } from './shift-schedule.controller';
import { ShiftScheduleService } from './shift-schedule.service';

// Meter Reading redesign (Section 3.3) — shift schedule CRUD. PrismaModule
// is global (see prisma.module.ts), so no imports needed. Exported so
// MeterReadingsModule can reuse it for the batch-close endpoint's shift
// labeling (see MeterReadingsService.batchClose()).
@Module({
  controllers: [ShiftScheduleController],
  providers: [ShiftScheduleService],
  exports: [ShiftScheduleService],
})
export class ShiftScheduleModule {}
