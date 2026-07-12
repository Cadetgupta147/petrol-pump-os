import { Module } from '@nestjs/common';
import { MeterReadingsController } from './meter-readings.controller';
import { MeterReadingsService } from './meter-readings.service';

@Module({
  controllers: [MeterReadingsController],
  providers: [MeterReadingsService],
})
export class MeterReadingsModule {}
