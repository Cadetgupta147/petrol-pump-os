import { Module } from '@nestjs/common';
import { TaxRateConfigController } from './tax-rate-config.controller';
import { TaxRateConfigService } from './tax-rate-config.service';

@Module({
  controllers: [TaxRateConfigController],
  providers: [TaxRateConfigService],
  exports: [TaxRateConfigService],
})
export class TaxRateConfigModule {}
