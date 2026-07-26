import { Module } from '@nestjs/common';
import { MachineTestingController } from './machine-testing.controller';
import { MachineTestingService } from './machine-testing.service';

// PrismaModule is global (see prisma.module.ts), so no imports needed.
@Module({
  controllers: [MachineTestingController],
  providers: [MachineTestingService],
})
export class MachineTestingModule {}
