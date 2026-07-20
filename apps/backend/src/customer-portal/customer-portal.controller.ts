import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CustomerJwtAuthGuard } from '../customer-auth/guards/customer-jwt-auth.guard';
import { AuthenticatedCustomer } from '../customer-auth/types/customer-jwt-payload.interface';
import { CustomerPortalService } from './customer-portal.service';
import { CreateCustomerRedemptionDto } from './dto/create-customer-redemption.dto';
import { ListBillsQueryDto } from './dto/list-bills-query.dto';

// Section 5/6 — the Credit Customer App's own data surface: home screen
// (profile + balance), bill history, gift catalog, and redemption.
//
// Every route here carries BOTH @Public() (opts OUT of the global staff
// JwtAuthGuard registered as APP_GUARD in app.module.ts, which would
// otherwise 401 a customer token before CustomerJwtAuthGuard ever runs) AND
// @UseGuards(CustomerJwtAuthGuard) (requires a valid customer token) — see
// CustomerJwtAuthGuard's header comment for why forgetting either one is a
// real security bug. Applied at the class level here specifically so no
// individual route can forget one half of the pair.
//
// The acting customer is ALWAYS read from req.user (populated by
// CustomerJwtStrategy.validate() from a verified, tokenVersion-checked JWT)
// — never from a request body or query param. This is the only thing
// standing between one customer and another customer's balance,
// bills, or redemptions, so no method below accepts a customerId from the
// caller in any form.
interface AuthenticatedRequest extends Request {
  user: AuthenticatedCustomer;
}

@Public()
@UseGuards(CustomerJwtAuthGuard)
@Controller('customer-portal')
export class CustomerPortalController {
  constructor(private readonly customerPortalService: CustomerPortalService) {}

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.customerPortalService.getMe(req.user.customerId);
  }

  @Get('bills')
  bills(@Req() req: AuthenticatedRequest, @Query() query: ListBillsQueryDto) {
    return this.customerPortalService.getBills(req.user.customerId, query.limit);
  }

  @Get('gift-catalog')
  giftCatalog(@Req() req: AuthenticatedRequest) {
    return this.customerPortalService.getGiftCatalog(req.user.customerId);
  }

  @Post('redemptions')
  createRedemption(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCustomerRedemptionDto,
  ) {
    return this.customerPortalService.createRedemption(req.user.customerId, dto);
  }
}
