import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

// Item Master (Settings: "what does this pump sell"). Auth: every route
// requires a valid JWT (global JwtAuthGuard). Create/update are Owner/
// Accountant/Manager — the user explicitly wants Manager able to maintain
// this list (contrast Nozzle/Tank setup, Owner/Accountant only), so it's
// deliberately a wider set here. Reads additionally allow DSM: nozzle/bill
// entry flows elsewhere may want to show item names.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.itemsService.create(dto);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Get()
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.itemsService.findAll(includeInactive === 'true');
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itemsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.itemsService.update(id, dto);
  }
}
