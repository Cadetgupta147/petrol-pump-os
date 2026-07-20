import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

// Minimal staff-directory list (id + name only) — see StaffController's
// top comment. PrismaModule is global (prisma.module.ts), so no imports
// needed here.
@Module({
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
