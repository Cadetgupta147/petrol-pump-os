import { apiFetch } from './client';
import type { CreateMachineTestingLogRequest, MachineTestingLog } from './types';

// POST /machine-testing-logs — Owner/Accountant/Manager only server-side.
// 404s if tankId doesn't match a real Tank (MachineTestingService.create()).
export function createMachineTestingLog(
  dto: CreateMachineTestingLogRequest,
): Promise<MachineTestingLog> {
  return apiFetch<MachineTestingLog>('/machine-testing-logs', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// GET /machine-testing-logs — most recent first.
export function getMachineTestingLogs(): Promise<MachineTestingLog[]> {
  return apiFetch<MachineTestingLog[]>('/machine-testing-logs');
}
