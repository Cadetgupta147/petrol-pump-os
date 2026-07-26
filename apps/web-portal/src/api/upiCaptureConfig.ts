import { apiFetch } from './client';
import type { UpdateUpiCaptureConfigRequest, UpiCaptureConfig } from './types';

// GET /upi-capture-config — Section 8A.3. Readable by Owner/Accountant/
// Manager/DSM server-side (the DSM app needs autoCaptureEnabled to decide
// whether to show UPI as an editable field — see upi-capture-config.controller.ts).
// Never 404s: UpiCaptureConfigService.getOrCreate() is an upsert-on-read
// singleton, same pattern as /credit-config.
export function getUpiCaptureConfig(): Promise<UpiCaptureConfig> {
  return apiFetch<UpiCaptureConfig>('/upi-capture-config');
}

// PATCH /upi-capture-config — Owner-ONLY server-side (entering merchant
// credentials and flipping auto-capture on/off is a business-settings
// decision, same category as credit enforcement mode). The UI hides the
// form for non-owners too, but the @Roles(Role.OWNER) guard on the backend
// is the real enforcement.
export function updateUpiCaptureConfig(
  dto: UpdateUpiCaptureConfigRequest,
): Promise<UpiCaptureConfig> {
  return apiFetch<UpiCaptureConfig>('/upi-capture-config', {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
