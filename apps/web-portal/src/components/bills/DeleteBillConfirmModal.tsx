import { useState } from 'react';
import { deleteBill } from '../../api/bills';
import { ApiError } from '../../api/client';
import type { Bill } from '../../api/types';

interface DeleteBillConfirmModalProps {
  bill: Bill;
  onClose: () => void;
  onDeleted: (bill: Bill) => void;
}

// Owner-only confirmation step before DELETE /bills/:id fires (Section
// 3.2 deviation — see the comment on BillsController.remove(); a single
// click must never delete). Reuses the same modal-overlay/modal-card/
// modal-actions look as BillFormModal/CustomerFormModal rather than a
// native window.confirm(), since there's no existing dedicated confirm
// dialog component in this codebase yet.
export function DeleteBillConfirmModal({ bill, onClose, onDeleted }: DeleteBillConfirmModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const deleted = await deleteBill(bill.id);
      onDeleted(deleted);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <h3>Delete this bill?</h3>
        </div>

        <p className="form-error">
          This bill ({bill.customerName ?? bill.vehicleNumber ?? 'Walk-in bill'}, {' '}
          {bill.amount.toFixed(2)}) will be marked deleted. This cannot be undone from here.
        </p>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="export-btn" onClick={() => { void handleConfirm(); }} disabled={submitting}>
            {submitting ? 'Deleting…' : 'Delete bill'}
          </button>
        </div>
      </div>
    </div>
  );
}
