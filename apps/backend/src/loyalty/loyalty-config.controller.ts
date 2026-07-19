import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Put,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoyaltyService } from './loyalty.service';
import { UpsertLoyaltyConfigDto } from './dto/upsert-loyalty-config.dto';

// Section 6.2 — dealer-level loyalty earning config.
//
// Auth: every route requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). Writes are Owner-ONLY — Section 2 explicitly lists
// "cannot change loyalty rates" as an Accountant restriction, and
// roles.decorator.ts flags loyalty-config as one of the endpoints that MUST
// be @Roles(Role.OWNER). Reads additionally allow Accountant (viewing the
// config is not changing it, and Accountant has view access to all business
// data per Section 2).
@Controller('loyalty-config')
export class LoyaltyConfigController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  // 404 until the dealer has configured loyalty (no hardcoded defaults —
  // Section 17 open decision). An explicit 404 rather than an empty 200:
  // Nest serializes a null return as an empty body, which JSON clients
  // can't distinguish from a broken response — clients treat this 404 as
  // "not configured yet", not as an error (see web-portal api/loyalty.ts).
  @Roles(Role.OWNER, Role.ACCOUNTANT)
  @Get()
  async get() {
    const config = await this.loyaltyService.getConfig();
    if (!config) {
      throw new NotFoundException(
        'Loyalty config is not set yet — Owner must PUT /loyalty-config first',
      );
    }
    return config;
  }

  // PUT (not PATCH) on purpose: with no schema/server defaults to fall back
  // on, a partial first write could create a config with no rate or basis —
  // so every write must state earningBasis + defaultRate in full.
  @Roles(Role.OWNER)
  @Put()
  upsert(@Body() dto: UpsertLoyaltyConfigDto) {
    return this.loyaltyService.upsertConfig(dto);
  }
}
