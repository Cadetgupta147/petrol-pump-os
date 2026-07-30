import { apiFetch } from './client';
import type {
  BatchCloseReadingRequest,
  BatchCloseRequest,
  CloseShiftRequest,
  CorrectMeterReadingRequest,
  MeterReading,
  MeterVariance,
} from './types';

// PATCH /meter-readings/:id/close — shift-end closing reading entry. Section
// 7.2's auto tank-deduct happens server-side; a non-blocking tankWarning may
// come back on the response (see MeterReading.tankWarning).
export function closeShift(id: string, dto: CloseShiftRequest): Promise<MeterReading> {
  return apiFetch<MeterReading>(`/meter-readings/${id}/close`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// PATCH /meter-readings/:id/correct — Owner/Accountant only. Corrects a
// reading's opening/closing value after the fact — see
// CorrectMeterReadingRequest's comment for the exact rules (bounded
// one-shift cascade, tank stock delta adjustment).
export function correctMeterReading(
  id: string,
  dto: CorrectMeterReadingRequest,
): Promise<MeterReading> {
  return apiFetch<MeterReading>(`/meter-readings/${id}/correct`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// POST /meter-readings/batch-close — Meter Reading redesign (Section 3.3):
// submit closing readings for every active nozzle at once, in one request.
// Replaces opening a shift as a separate step — see BatchCloseReadingRequest's
// comment. Returns one updated MeterReading per submitted nozzle, each
// possibly carrying its own tankWarning. shiftEnd backdates the whole batch
// (see BatchCloseRequest's comment) — omit it for the normal real-time close.
export function batchCloseMeterReadings(
  readings: BatchCloseReadingRequest[],
  shiftEnd?: string,
): Promise<MeterReading[]> {
  const body: BatchCloseRequest = shiftEnd ? { readings, shiftEnd } : { readings };
  return apiFetch<MeterReading[]>('/meter-readings/batch-close', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// GET /meter-readings — every shift (open and closed), newest shiftStart
// first. No date filter server-side; the dashboard filters to "today" (by
// shiftStart's local calendar date) client-side.
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
