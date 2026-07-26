import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { ItemSalesService } from './item-sales.service';
import { CreateItemSaleDto } from './dto/create-item-sale.dto';

// Dashboard "Lubricant sale" / "Urea/DEF sale" slice. Owner/Accountant/
// Manager — same set as ExpensesController/GeneratorDieselController/
// MachineTestingController. DSM-app wiring is a known follow-up, not built
// here (mobile work waits on a stable API contract per CLAUDE.md's phase-
// order rule) — a DSM hitting this page gets the backend's 403 like any
// other web-portal-only module.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('item-sales')
export class ItemSalesController {
  constructor(private readonly itemSalesService: ItemSalesService) {}

  @Post()
  create(@Body() dto: CreateItemSaleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.itemSalesService.create(dto, user.staffId);
  }

  @Get()
  findAll() {
    return this.itemSalesService.findAll();
  }
}
