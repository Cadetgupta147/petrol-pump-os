import { Module } from '@nestjs/common';
import { ItemSalesController } from './item-sales.controller';
import { ItemSalesService } from './item-sales.service';

// PrismaModule is global (see prisma.module.ts), so no imports needed.
@Module({
  controllers: [ItemSalesController],
  providers: [ItemSalesService],
})
export class ItemSalesModule {}
