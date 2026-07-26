import { Module } from '@nestjs/common';
import { LubricantItemsController } from './lubricant-items.controller';
import { LubricantItemsService } from './lubricant-items.service';

// PrismaModule is global (see prisma.module.ts), so no imports needed.
@Module({
  controllers: [LubricantItemsController],
  providers: [LubricantItemsService],
})
export class LubricantItemsModule {}
