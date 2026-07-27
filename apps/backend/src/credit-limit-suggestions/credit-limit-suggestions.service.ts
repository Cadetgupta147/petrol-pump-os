import { Injectable } from '@nestjs/common';
import { CreditAgingService } from '../credit-aging/credit-aging.service';
import { computeCreditLimitSuggestion } from './credit-limit-suggestions.util';

// Section 17.25 — reuses CreditAgingService.getReport() (already scoped to
// "customers who have ever touched credit") as the input signal rather than
// running a second, subtly different query — see credit-limit-suggestions.util.ts
// for the full methodology writeup and its judgment call.
@Injectable()
export class CreditLimitSuggestionsService {
  constructor(private readonly creditAgingService: CreditAgingService) {}

  async getSuggestions() {
    const { asOf, customers } = await this.creditAgingService.getReport();

    const suggestions = customers.map((row) => {
      const suggestion = computeCreditLimitSuggestion({
        creditLimit: row.creditLimit,
        bucket15to30: row.bucket15to30,
        bucket30Plus: row.bucket30Plus,
        totalOutstanding: row.totalOutstanding,
      });
      return {
        customerId: row.customerId,
        customerName: row.customerName,
        phone: row.phone,
        currentLimit: row.creditLimit,
        totalOutstanding: row.totalOutstanding,
        bucket30Plus: row.bucket30Plus,
        ...suggestion,
      };
    });

    return { asOf, suggestions };
  }
}
