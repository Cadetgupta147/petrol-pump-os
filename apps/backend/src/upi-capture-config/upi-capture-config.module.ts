import { Module } from '@nestjs/common';
import { UpiCaptureConfigController } from './upi-capture-config.controller';
import { UpiCaptureConfigService } from './upi-capture-config.service';

@Module({
  controllers: [UpiCaptureConfigController],
  providers: [UpiCaptureConfigService],
  exports: [UpiCaptureConfigService],
})
export class UpiCaptureConfigModule {}
