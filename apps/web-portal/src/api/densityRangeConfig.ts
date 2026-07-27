import { apiFetch } from './client';
import type { DensityRangeConfig, UpsertDensityRangeConfigRequest } from './types';

// GET /density-range-config — Section 17.19. Owner/Accountant read.
export function getDensityRangeConfigs(): Promise<DensityRangeConfig[]> {
  return apiFetch<DensityRangeConfig[]>('/density-range-config');
}

// PUT /density-range-config — Owner-only server-side. Upserts by
// productType (one row per product per pump); 400 if minDensity >=
// maxDensity, surfaced directly (DensityRangeConfigService.upsert()).
export function upsertDensityRangeConfig(
  dto: UpsertDensityRangeConfigRequest,
): Promise<DensityRangeConfig> {
  return apiFetch<DensityRangeConfig>('/density-range-config', {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}
