import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { LedgerAccountsService } from './ledger-accounts.service';
import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import { UpdateLedgerAccountDto } from './dto/update-ledger-account.dto';

// Ledger Master — account head names/groups vary pump to pump ("BABU JI",
// "PETRO CARD", "TOLL" at one pump mean nothing at another), so this is
// dealer-configured, not seeded with defaults (see LedgerAccountsService —
// the only ledgers ever auto-created are the handful LedgerPostingService
// needs to post to at all, matched by systemKey not name, and even those
// stay renameable here). Owner/Accountant/Manager can all set it up;
// Read-only can view but not change it — deliberately wider than most
// financial-entry surfaces in this codebase (cash custody, expenses are
// Owner/Accountant-only to create) since this is master-data setup, not a
// money-moving transaction.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.READ_ONLY)
@Controller('ledger-accounts')
export class LedgerAccountsController {
  constructor(private readonly ledgerAccountsService: LedgerAccountsService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
  @Post()
  create(@Body() dto: CreateLedgerAccountDto) {
    return this.ledgerAccountsService.create(dto);
  }

  @Get()
  findAll() {
    return this.ledgerAccountsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ledgerAccountsService.findOne(id);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLedgerAccountDto) {
    return this.ledgerAccountsService.update(id, dto);
  }

  @Roles(Role.OWNER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ledgerAccountsService.remove(id);
  }
}
