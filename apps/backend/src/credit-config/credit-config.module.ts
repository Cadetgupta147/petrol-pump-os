import { Module } from '@nestjs/common';
import { CreditConfigController } from './credit-config.controller';
import { CreditConfigService } from './credit-config.service';

@Module({
  controllers: [CreditConfigController],
  providers: [CreditConfigService],
  exports: [CreditConfigService],
})
export class CreditConfigModule {}
