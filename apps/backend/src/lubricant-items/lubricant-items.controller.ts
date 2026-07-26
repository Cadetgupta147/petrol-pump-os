import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { LubricantItemsService } from './lubricant-items.service';
import { CreateLubricantItemDto } from './dto/create-lubricant-item.dto';
import { UpdateLubricantItemDto } from './dto/update-lubricant-item.dto';

// Lubricant stock/pricing catalog (Settings). Owner/Accountant/Manager —
// same access level as Item Master itself (ItemsController).
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('lubricant-items')
export class LubricantItemsController {
  constructor(private readonly lubricantItemsService: LubricantItemsService) {}

  @Post()
  create(@Body() dto: CreateLubricantItemDto) {
    return this.lubricantItemsService.create(dto);
  }

  @Get()
  findAll() {
    return this.lubricantItemsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.lubricantItemsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLubricantItemDto) {
    return this.lubricantItemsService.update(id, dto);
  }
}
