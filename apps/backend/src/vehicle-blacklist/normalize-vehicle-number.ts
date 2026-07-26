// A DSM typing "mh 12 ab 1234" and an Owner blacklisting "MH12AB1234" must
// match — Bill.vehicleNumber and Customer.vehicleNumber are free-text
// elsewhere in this codebase (no normalization on write), but a blacklist
// that only matches on exact-string equality would silently fail to catch
// the one case it exists for. Normalizing on both write (create()) and read
// (findBlockingEntry()) here, scoped to this module only — this deliberately
// does NOT touch how vehicleNumber is stored on Bill/Customer, to avoid
// widening this change into an unrelated data-migration.
export function normalizeVehicleNumber(vehicleNumber: string): string {
  return vehicleNumber.trim().toUpperCase().replace(/\s+/g, '');
}
