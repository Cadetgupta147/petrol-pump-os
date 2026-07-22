import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

// Item Master CRUD. PrismaModule is global, so no imports needed. Exported
// so NozzlesModule/other modules could reuse it if they ever need more than
// a raw Prisma lookup.
@Module({
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
