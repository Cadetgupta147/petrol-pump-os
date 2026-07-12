import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so every feature module (bills, staff, loyalty, etc.) can inject
// PrismaService without re-importing this module each time.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
