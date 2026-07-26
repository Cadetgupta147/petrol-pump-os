import { apiFetch } from './client';
import type { CreateGeneratorDieselLogRequest, GeneratorDieselLog } from './types';

// POST /generator-diesel-logs — Owner/Accountant/Manager only server-side.
// 404s if tankId doesn't match a real Tank (GeneratorDieselService.create()).
export function createGeneratorDieselLog(
  dto: CreateGeneratorDieselLogRequest,
): Promise<GeneratorDieselLog> {
  return apiFetch<GeneratorDieselLog>('/generator-diesel-logs', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// GET /generator-diesel-logs — most recent first.
export function getGeneratorDieselLogs(): Promise<GeneratorDieselLog[]> {
  return apiFetch<GeneratorDieselLog[]>('/generator-diesel-logs');
}
