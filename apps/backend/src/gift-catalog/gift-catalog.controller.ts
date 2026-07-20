import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { GiftCatalogService } from './gift-catalog.service';
import { CreateGiftCatalogItemDto } from './dto/create-gift-catalog-item.dto';
import { UpdateGiftCatalogItemDto } from './dto/update-gift-catalog-item.dto';

// Section 6.4 Lever 2 — gift catalog CRUD.
//
// Auth: every route requires a valid JWT (global JwtAuthGuard, app.module.ts).
// Writes (create/update/remove) are Owner-ONLY: Section 6.4 frames the whole
// redemption side as "entirely the dealer's call — not just which options
// exist, but whether the customer gets a say at all", the same reasoning
// Section 2 uses for "Accountant cannot change loyalty rates" (see
// LoyaltyConfigController's PUT, also Owner-only). Reads additionally allow
// Accountant and DSM — DSM needs the live catalog to show a customer what
// they can redeem at the counter (Section 6.6), same reasoning as
// CustomersController.findByMemberId.
@Roles(Role.OWNER)
@Controller('gift-catalog')
export class GiftCatalogController {
  constructor(private readonly giftCatalogService: GiftCatalogService) {}

  @Post()
  create(@Body() dto: CreateGiftCatalogItemDto) {
    return this.giftCatalogService.create(dto);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get()
  findAll() {
    return this.giftCatalogService.findAll();
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.giftCatalogService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGiftCatalogItemDto) {
    return this.giftCatalogService.update(id, dto);
  }

  // DELETE here does NOT hard-delete — see GiftCatalogService.remove's
  // comment. Kept as DELETE (not a bespoke PATCH route) for REST consistency
  // with BillsController.remove, which is also a soft-action under the hood.
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.giftCatalogService.remove(id);
  }
}
