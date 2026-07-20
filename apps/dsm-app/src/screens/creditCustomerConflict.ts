import type { QuickAddCustomerInput } from '../api/billsApi';

// Bug fix (credit-attribution): a scanned customer must never silently
// replace the customer a CREDIT payment line was opened against — that would
// re-attribute money already meant to be owed by customer A onto customer B.
// Extracted into its own module (rather than living inside NewBillScreen.tsx)
// so the mismatch rule can be unit-tested directly and so
// react-refresh/only-export-components doesn't warn about a screen file
// exporting a non-component value. See NewBillScreen's handleCustomerResolved
// for where this gates the scan-resolved flow.
export interface CreditCustomerConflictArgs {
  hasCreditLine: boolean;
  creditCustomerId: string | undefined;
  creditQuickAdd: QuickAddCustomerInput | undefined;
  scannedCustomerId: string;
}

export function hasCreditCustomerConflict({
  hasCreditLine,
  creditCustomerId,
  creditQuickAdd,
  scannedCustomerId,
}: CreditCustomerConflictArgs): boolean {
  if (!hasCreditLine) return false;
  if (!creditCustomerId && !creditQuickAdd) return false;
  // A quick-added customer has no persisted id and therefore no member ID —
  // it can never be "the same person" as anyone a QR scan resolves to.
  if (creditQuickAdd) return true;
  return creditCustomerId !== scannedCustomerId;
}
