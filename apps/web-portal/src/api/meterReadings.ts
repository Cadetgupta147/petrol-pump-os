import { apiFetch } from './client';
import type {
  CloseShiftRequest,
  CorrectMeterReadingRequest,
  MeterReading,
  MeterVariance,
  OpenShiftRequest,
} from './types';

// POST /meter-readings — Section 3.3/4 shift-start entry: pick a nozzleId
// (from GET /nozzles); openingReading/productType are server-derived (the
// carry-forward rule), never sent here. This page's manual-entry fallback
// (the same call the DSM app's shift-start flow makes) — Owner/Accountant/
// DSM server-side, but only Owner/Accountant reach this page (Section 2: DSM
// has no web portal access).
export function openShift(dto: OpenShiftRequest): Promise<MeterReading> {
  return apiFetch<MeterReading>('/meter-readings', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

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
