import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createBill } from '../../api/bills';
import { getItems } from '../../api/items';
import { getRateHistory } from '../../api/rateMaster';
import { computeCurrentRates } from '../../utils/rateMaster';
import { ApiError } from '../../api/client';
import type { Bill, Customer, Item, RateHistory } from '../../api/types';

interface AddCreditBillModalProps {
  customers: Customer[];
  onClose: () => void;
  onCreated: (bill: Bill) => void;
}

// Fast path for the common "this whole fill-up goes on the customer's tab"
// case — a bill that's paid entirely on CREDIT never needs a payment-line
// breakdown, since there's only ever one possible line: {CREDIT, IN, the
// full amount}. AddCashBillModal (the general flow) still supports CREDIT
// as one of several split lines (Section 5A.2), so nothing here removes
// that; this is purely a quicker entry form for the fully-credit case,
// posting the same CreateBillRequest shape to the same POST /bills endpoint
// — BillsService.create() runs the exact same validation either way
// (balance check, credit limit/blacklist enforcement, amount-vs-rate
// tolerance), it just never sees more than one payment line here.
//
// Unlike AddCashBillModal, a customer (existing or quick-added) is ALWAYS
// required — CREDIT with no linked customer isn't a valid bill at all (see
// BillsService.create()'s "CREDIT payment lines require either an existing
// customerId or quickAddCustomer").
export function AddCreditBillModal({ customers, onClose, onCreated }: AddCreditBillModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [productType, setProductType] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);

  // Quick-add is the fallback whenever no existing customer is linked — see
  // Section 3.4A. Unlike AddCashBillModal this isn't conditional on "does a
  // CREDIT line exist" (every bill here IS a credit bill), so it's simply
  // "is a customer linked yet."
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddVehicle, setQuickAddVehicle] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getItems()
      .then(setItems)
      .catch(() => undefined);
    getRateHistory()
      .then(setRateHistory)
      .catch(() => undefined);
  }, []);

  const currentRateByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const rate of computeCurrentRates(rateHistory)) map.set(rate.productType, rate.rate);
    return map;
  }, [rateHistory]);

  // Same amount/litres auto-fill convenience as AddCashBillModal — see that
  // component's comment for why both fields stay freely editable afterward
  // rather than one becoming read-only.
  function handleAmountChange(value: string) {
    setAmount(value);
    const rate = currentRateByProduct.get(productType.trim());
    const parsedAmount = Number(value);
    if (rate && parsedAmount > 0) {
      setLitres((parsedAmount / rate).toFixed(2));
    }
  }

  function handleLitresChange(value: string) {
    setLitres(value);
    const rate = currentRateByProduct.get(productType.trim());
    const parsedLitres = Number(value);
    if (rate && parsedLitres > 0) {
      setAmount((parsedLitres * rate).toFixed(2));
    }
  }

  function handleProductTypeChange(value: string) {
    setProductType(value);
    const rate = currentRateByProduct.get(value.trim());
    const parsedAmount = Number(amount);
    if (rate && parsedAmount > 0) {
      setLitres((parsedAmount / rate).toFixed(2));
    }
  }

  const resolvedRate = currentRateByProduct.get(productType.trim());

  function handleSelectCustomer(id: string) {
    setCustomerId(id);
    const customer = customers.find((c) => c.id === id);
    if (customer) {
      setCustomerName(customer.name);
      if (customer.vehicleNumber) setVehicleNumber(customer.vehicleNumber);
    }
  }

  const needsQuickAdd = !customerId;
  const parsedBillAmount = Number(amount) || 0;
  const hasVehicleOrName = vehicleNumber.trim() !== '' || customerName.trim() !== '';

  const canSave =
    !submitting &&
    hasVehicleOrName &&
    parsedBillAmount > 0 &&
    Number(litres) > 0 &&
    productType.trim() !== '' &&
    (!needsQuickAdd || (quickAddName.trim() !== '' && quickAddVehicle.trim() !== ''));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setError(null);
    setSubmitting(true);
    try {
      const trimmedVehicle = vehicleNumber.trim();
      const trimmedCustomerName = customerName.trim();
      const bill = await createBill({
        customerId: customerId || undefined,
        quickAddCustomer: needsQuickAdd
          ? { name: quickAddName.trim(), vehicleNumber: quickAddVehicle.trim() }
          : undefined,
        vehicleNumber: trimmedVehicle === '' ? undefined : trimmedVehicle,
        customerName: trimmedCustomerName === '' ? undefined : trimmedCustomerName,
        amount: parsedBillAmount,
        litres: Number(litres),
        productType: productType.trim(),
        entryChannel: 'WEB',
        // The whole point of this modal: exactly one payment line, always
        // CREDIT, always the full bill amount — never hand-entered.
        paymentLines: [{ paymentType: 'CREDIT', amount: parsedBillAmount, direction: 'IN' }],
      });
      onCreated(bill);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>Add credit bill</h3>
          <span className="section-note">
            The full amount is put on the customer&rsquo;s tab — no payment breakdown to fill in.
          </span>
        </div>

        <div className="form-field">
          <label htmlFor="acb-customer">Customer (required for credit)</label>
          <select id="acb-customer" value={customerId} onChange={(e) => handleSelectCustomer(e.target.value)} required>
            <option value="">Select a customer, or quick-add below</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.vehicleNumber ? ` · ${customer.vehicleNumber}` : ''}
              </option>
            ))}
          </select>
        </div>

        {!customerId && (
          <div className="form-field">
            <label>New credit customer (Section 3.4A quick-add)</label>
            <div className="section-note" style={{ marginBottom: 8 }}>
              No existing customer picked above — quick-add one now with just a name and vehicle number.
            </div>
            <input
              value={quickAddName}
              onChange={(e) => setQuickAddName(e.target.value)}
              placeholder="Name"
              style={{ marginBottom: 8 }}
            />
            <input
              value={quickAddVehicle}
              onChange={(e) => setQuickAddVehicle(e.target.value)}
              placeholder="Vehicle number"
            />
          </div>
        )}

        <div className="form-field">
          <label htmlFor="acb-vehicle">Vehicle number</label>
          <input
            id="acb-vehicle"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
            placeholder="Optional if customer name is set"
          />
        </div>
        {!hasVehicleOrName && <div className="form-error">Vehicle number or customer name is required.</div>}

        <div className="form-field">
          <label htmlFor="acb-amount">Amount (Rs.)</label>
          <input
            id="acb-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="acb-litres">Litres</label>
          <input
            id="acb-litres"
            type="number"
            min="0"
            step="0.01"
            value={litres}
            onChange={(e) => handleLitresChange(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="acb-product">Product type</label>
          <input
            id="acb-product"
            list="acb-item-master"
            value={productType}
            onChange={(e) => handleProductTypeChange(e.target.value)}
            placeholder="e.g. Petrol, Diesel"
            required
          />
          <datalist id="acb-item-master">
            {items.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
          {productType.trim() !== '' && (
            <div className="section-note" style={{ marginTop: 4 }}>
              {resolvedRate
                ? `Current rate: Rs.${resolvedRate.toFixed(2)}/L — amount/litres auto-fill off this.`
                : 'No current rate on file for this product — enter amount and litres manually.'}
            </div>
          )}
        </div>

        <div className="form-field">
          <div className="section-note">
            This entire amount — Rs.{parsedBillAmount.toFixed(2)} — will be recorded as CREDIT for this customer.
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={!canSave}>
            {submitting ? 'Saving…' : 'Add credit bill'}
          </button>
        </div>
      </form>
    </div>
  );
}
