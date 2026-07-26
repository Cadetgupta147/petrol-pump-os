import { Module } from '@nestjs/common';
import { VehicleBlacklistController } from './vehicle-blacklist.controller';
import { VehicleBlacklistService } from './vehicle-blacklist.service';

// PrismaModule is global (see prisma.module.ts), so no import needed here.
// VehicleBlacklistService is exported so BillsModule can inject it for the
// assertNotBlacklisted() check inside BillsService.create().
@Module({
  controllers: [VehicleBlacklistController],
  providers: [VehicleBlacklistService],
  exports: [VehicleBlacklistService],
})
export class VehicleBlacklistModule {}
