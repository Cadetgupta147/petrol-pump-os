import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditLimitSuggestionsService } from './credit-limit-suggestions.service';

// Section 17.25 — automated credit scoring, as a transparent suggestion
// only. Same role set as CreditAgingController (this is a different lens on
// the same aging data) — Read-only can view but has no PATCH /customers
// access to act on it anyway.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.READ_ONLY)
@Controller('credit-limit-suggestions')
export class CreditLimitSuggestionsController {
  constructor(private readonly creditLimitSuggestionsService: CreditLimitSuggestionsService) {}

  @Get()
  getSuggestions() {
    return this.creditLimitSuggestionsService.getSuggestions();
  }
}
