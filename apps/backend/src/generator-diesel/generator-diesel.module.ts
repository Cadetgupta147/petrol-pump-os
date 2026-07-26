import { Module } from '@nestjs/common';
import { GeneratorDieselController } from './generator-diesel.controller';
import { GeneratorDieselService } from './generator-diesel.service';

// PrismaModule is global (see prisma.module.ts), so no imports needed.
@Module({
  controllers: [GeneratorDieselController],
  providers: [GeneratorDieselService],
})
export class GeneratorDieselModule {}
