import { Module } from '@nestjs/common';
import { DensityRangeConfigController } from './density-range-config.controller';
import { DensityRangeConfigService } from './density-range-config.service';

@Module({
  controllers: [DensityRangeConfigController],
  providers: [DensityRangeConfigService],
})
export class DensityRangeConfigModule {}
