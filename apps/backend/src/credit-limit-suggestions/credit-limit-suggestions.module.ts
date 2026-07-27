import { Module } from '@nestjs/common';
import { CreditLimitSuggestionsController } from './credit-limit-suggestions.controller';
import { CreditLimitSuggestionsService } from './credit-limit-suggestions.service';
import { CreditAgingModule } from '../credit-aging/credit-aging.module';

@Module({
  imports: [CreditAgingModule],
  controllers: [CreditLimitSuggestionsController],
  providers: [CreditLimitSuggestionsService],
})
export class CreditLimitSuggestionsModule {}
