import { Test, TestingModule } from '@nestjs/testing';
import { CreditLimitSuggestionsService } from './credit-limit-suggestions.service';
import { CreditAgingService } from '../credit-aging/credit-aging.service';

// Section 17.25 — confirms this service maps CreditAgingService's report
// rows through computeCreditLimitSuggestion() rather than duplicating any
// aging logic of its own.
describe('CreditLimitSuggestionsService', () => {
  let service: CreditLimitSuggestionsService;
  let creditAgingService: { getReport: jest.Mock };

  beforeEach(async () => {
    creditAgingService = { getReport: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditLimitSuggestionsService,
        { provide: CreditAgingService, useValue: creditAgingService },
      ],
    }).compile();

    service = module.get(CreditLimitSuggestionsService);
  });

  it('maps each aging row through the suggestion rule, preserving identifying fields', async () => {
    const asOf = new Date('2026-07-27T00:00:00Z');
    creditAgingService.getReport.mockResolvedValue({
      asOf,
      customers: [
        {
          customerId: 'cust-1',
          customerName: 'Ramesh',
          phone: '9990000001',
          creditLimit: 10000,
          bucket0to15: 0,
          bucket15to30: 0,
          bucket30Plus: 0,
          totalOutstanding: 0,
          hasOutstandingBalance: false,
        },
      ],
    });

    const result = await service.getSuggestions();

    expect(result.asOf).toBe(asOf);
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        customerId: 'cust-1',
        customerName: 'Ramesh',
        currentLimit: 10000,
        action: 'INCREASE',
        suggestedLimit: 12000,
      }),
    ]);
  });
});
