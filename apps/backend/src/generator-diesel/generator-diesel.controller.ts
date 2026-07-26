import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { GeneratorDieselService } from './generator-diesel.service';
import { CreateGeneratorDieselLogDto } from './dto/create-generator-diesel-log.dto';

// Dashboard "Generator diesel used" slice. Owner/Accountant/Manager —
// day-to-day ops entry, same set as ExpensesController.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('generator-diesel-logs')
export class GeneratorDieselController {
  constructor(private readonly generatorDieselService: GeneratorDieselService) {}

  @Post()
  create(
    @Body() dto: CreateGeneratorDieselLogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generatorDieselService.create(dto, user.staffId);
  }

  @Get()
  findAll() {
    return this.generatorDieselService.findAll();
  }
}
