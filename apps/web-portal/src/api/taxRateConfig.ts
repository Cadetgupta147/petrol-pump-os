import { apiFetch } from './client';
import type { TaxRateConfig, UpsertTaxRateConfigRequest } from './types';

// GET /tax-rate-config — Section 17.22. Owner/Accountant/Read-only.
export function getTaxRateConfigs(): Promise<TaxRateConfig[]> {
  return apiFetch<TaxRateConfig[]>('/tax-rate-config');
}

// PUT /tax-rate-config — Owner-only server-side. Upserts by productType.
export function upsertTaxRateConfig(
  dto: UpsertTaxRateConfigRequest,
): Promise<TaxRateConfig> {
  return apiFetch<TaxRateConfig>('/tax-rate-config', {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}
