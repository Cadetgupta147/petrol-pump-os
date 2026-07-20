import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

// Section 12 — staff attendance (clock-in/out + hours-worked summary).
// PrismaModule is global (see prisma.module.ts), so no imports needed.
@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
