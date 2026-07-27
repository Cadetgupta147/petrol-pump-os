import { Module } from '@nestjs/common';
import { StaffAdvancesController } from './staff-advances.controller';
import { StaffAdvancesService } from './staff-advances.service';

@Module({
  controllers: [StaffAdvancesController],
  providers: [StaffAdvancesService],
  exports: [StaffAdvancesService],
})
export class StaffAdvancesModule {}
