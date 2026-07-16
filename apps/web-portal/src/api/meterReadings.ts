import { apiFetch } from './client';
import type { MeterReading, MeterVariance } from './types';

// GET /meter-readings — every shift (open and closed), newest shiftStart
// first. No date filter server-side; the dashboard filters to "today" (by
// shiftStart's local calendar date) client-side.
//
// Note on scope: nozzleId is a free-text string on MeterReading (see
// prisma/schema.prisma) — there is no Nozzle model, so nothing in the API
// maps a nozzle to a fuel type (petrol/diesel). The dashboard shows nozzleId
// as-is rather than guessing a fuel type from it.
export function getAllMeterReadings(): Promise<MeterReading[]> {
  return apiFetch<MeterReading[]>('/meter-readings');
}

// GET /meter-readings/:id/variance — only callable once a shift is closed
// (closingReading + shiftEnd set). Compares the meter's litresSold against
// litresBilled, which meter-readings.service.ts itself flags as an
// approximation (Bill has no nozzleId/shiftId FK yet — see the KNOWN SCOPE
// GAP comment in that file).
export function getMeterVariance(id: string): Promise<MeterVariance> {
  return apiFetch<MeterVariance>(`/meter-readings/${id}/variance`);
}
