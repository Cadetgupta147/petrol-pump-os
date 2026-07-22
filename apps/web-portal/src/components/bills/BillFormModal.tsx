import { useState, type FormEvent } from 'react';
import { updateBill } from '../../api/bills';
import { ApiError } from '../../api/client';
import type { Bill } from '../../api/types';

interface BillFormModalProps {
  // This modal only ever edits an existing bill (Section 3.2 web-side edit
  // parity) — there's no "add" mode here, unlike CustomerFormModal. Manual
  // bill *creation* isn't wired up on this page.
  bill: Bill;
  onClose: () => void;
  onSaved: (bill: Bill) => void;
}

// PATCH-only edit form for an existing bill (Section 3.2). Deliberately
// omits customerId and paymentLines — this page edits the scalar fields
// only; changing which customer a bill is linked to or replacing its split
// payment lines isn't in scope here (see UpdateBillRequest in api/types.ts).
export function BillFormModal({ bill, onClose, onSaved }: BillFormModalProps) {
  const [vehicleNumber, setVehicleNumber] = useState(bill.vehicleNumber ?? '');
  const [customerName, setCustomerName] = useState(bill.customerName ?? '');
  const [amount, setAmount] = useState(String(bill.amount));
  const [litres, setLitres] = useState(String(bill.litres));
  const [productType, setProductType] = useState(bill.productType);
  const [rateApplied, setRateApplied] = useState(String(bill.rateApplied));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedVehicle = vehicleNumber.trim();
      const trimmedCustomerName = customerName.trim();

      const saved = await updateBill(bill.id, {
        vehicleNumber: trimmedVehicle === '' ? undefined : trimmedVehicle,
        customerName: trimmedCustomerName === '' ? undefined : trimmedCustomerName,
        amount: Number(amount),
        litres: Number(litres),
        productType: productType.trim(),
        rateApplied: Number(rateApplied),
      });

      onSaved(saved);
    } catch (err) {
      // Backend validation (Section 4's vehicle-or-name rule, Section 5A's
      // split-payment balance check) is the real enforcement — we just
      // surface whatever message it sends back rather than re-validating
      // client-side.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>Edit bill</h3>
        </div>

        <div className="form-field">
          <label htmlFor="bf-customer-name">Customer name</label>
          <input
            id="bf-customer-name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Optional if vehicle number is set"
          />
        </div>
        <div className="form-field">
          <label htmlFor="bf-vehicle">Vehicle number</label>
          <input
            id="bf-vehicle"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
            placeholder="Optional if customer name is set"
          />
        </div>
        <div className="form-field">
          <label htmlFor="bf-amount">Amount (Rs.)</label>
          <input
            id="bf-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="bf-litres">Litres</label>
          <input
            id="bf-litres"
            type="number"
            min="0"
            step="0.01"
            value={litres}
            onChange={(e) => setLitres(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="bf-product">Product type</label>
          <input
            id="bf-product"
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="bf-rate">Rate applied (Rs./L)</label>
          <input
            id="bf-rate"
            type="number"
            min="0"
            step="0.01"
            value={rateApplied}
            onChange={(e) => setRateApplied(e.target.value)}
            required
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
