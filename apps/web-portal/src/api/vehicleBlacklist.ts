import { apiFetch } from './client';
import type {
  BlacklistStatus,
  CreateVehicleBlacklistRequest,
  ResolveVehicleBlacklistRequest,
  VehicleBlacklistEntry,
} from './types';

// GET /vehicle-blacklist — Section 3.4B. Open to every role that already
// sees credit data (see vehicle-blacklist.controller.ts's class-level
// @Roles), not just Owner.
export function getVehicleBlacklist(status?: BlacklistStatus): Promise<VehicleBlacklistEntry[]> {
  const query = status ? `?status=${status}` : '';
  return apiFetch<VehicleBlacklistEntry[]>(`/vehicle-blacklist${query}`);
}

// POST /vehicle-blacklist — Owner-ONLY server-side (same precedent as
// CreditConfigController: an active blacklist is a stronger, automatic
// block than enforcementMode ever applies). The UI hides the form for
// non-owners too, but the backend @Roles(Role.OWNER) guard is the real
// enforcement.
export function createVehicleBlacklistEntry(
  dto: CreateVehicleBlacklistRequest,
): Promise<VehicleBlacklistEntry> {
  return apiFetch<VehicleBlacklistEntry>('/vehicle-blacklist', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /vehicle-blacklist/:id/resolve — Owner-only, same reasoning as create.
export function resolveVehicleBlacklistEntry(
  id: string,
  dto: ResolveVehicleBlacklistRequest,
): Promise<VehicleBlacklistEntry> {
  return apiFetch<VehicleBlacklistEntry>(`/vehicle-blacklist/${id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
