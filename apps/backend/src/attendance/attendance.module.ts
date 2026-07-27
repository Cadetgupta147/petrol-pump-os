import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { StaffAdvancesModule } from '../staff-advances/staff-advances.module';

// Section 12 — staff attendance (clock-in/out + hours-worked summary).
// PrismaModule is global (see prisma.module.ts). StaffAdvancesModule
// (Section 17.23) is imported so getSummary() can fold outstanding
// advances into the salary/advances half of this report.
@Module({
  imports: [StaffAdvancesModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
