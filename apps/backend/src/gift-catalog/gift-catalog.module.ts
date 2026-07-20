import { Module } from '@nestjs/common';
import { GiftCatalogController } from './gift-catalog.controller';
import { GiftCatalogService } from './gift-catalog.service';

// Section 6.4 Lever 2 — gift catalog CRUD. PrismaModule is global (see
// prisma.module.ts), so no imports needed. GiftCatalogService is exported so
// RedemptionsModule can reuse it (gift lookup during a redemption) instead of
// duplicating GiftCatalogItem queries.
@Module({
  controllers: [GiftCatalogController],
  providers: [GiftCatalogService],
  exports: [GiftCatalogService],
})
export class GiftCatalogModule {}
