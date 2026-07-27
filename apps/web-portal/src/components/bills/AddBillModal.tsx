import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createBill } from '../../api/bills';
import { getItems } from '../../api/items';
import { getRateHistory } from '../../api/rateMaster';
import { computeCurrentRates } from '../../utils/rateMaster';
import { ApiError } from '../../api/client';
import type { Bill, Customer, Item, PaymentDirection, PaymentType, RateHistory } from '../../api/types';

interface AddBillModalProps {
  // Section 3.2 — manual bill entry, full web/DSM parity (NewBillScreen.tsx
  // in apps/dsm-app is the mobile equivalent this mirrors). Customers are
  // passed in rather than re-fetched: BillingRegisterPage already loads the
  // full list for its filter dropdown.
  customers: Customer[];
  onClose: () => void;
  onCreated: (bill: Bill) => void;
}

const PAYMENT_TYPES: PaymentType[] = ['CASH', 'CARD', 'UPI', 'CREDIT'];
const EPSILON = 0.01;

interface LocalPaymentLine {
  localId: string;
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
}

let localIdCounter = 0;
function makeLocalId(): string {
  localIdCounter += 1;
  return `abm-line-${localIdCounter}`;
}

// Section 3.2 (web-side manual entry, full parity with DSM app add) +
// Section 5A (split payments, must balance) + Section 3.4A (inline
// quick-add of an informal credit customer at bill time). Deliberately
// omits the DSM app's QR-scan flow (Section 6.3) — the web portal already
// has the full customer list loaded (getAllCustomers()), so "pick from a
// dropdown" replaces "scan a card" here — and the live loyalty-points
// preview banner, which is a non-blocking display convenience; the server
// still computes and credits points authoritatively either way (see
// BillsService.create()). The blacklist pre-check is skipped for the same
// reason the DSM app's comment gives for its own pre-check: it's a
// convenience only, Save fails with the same message either way because
// VehicleBlacklistService.assertNotBlacklisted() is the real, authoritative
// block.
export function AddBillModal({ customers, onClose, onCreated }: AddBillModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [productType, setProductType] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);

  const [lines, setLines] = useState<LocalPaymentLine[]>([]);
  const [draftType, setDraftType] = useState<PaymentType>('CASH');
  const [draftAmount, setDraftAmount] = useState('');
  const [draftDirection, setDraftDirection] = useState<PaymentDirection>('IN');

  // Section 3.4A — only meaningful while a CREDIT line exists and no
  // existing customer is linked; mutually exclusive with customerId, same
  // as BillsService.create()'s validation.
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

  // productType -> current rate (Rs./L), same "latest effectiveFrom <= now"
  // logic as the server (see utils/rateMaster.ts). Exact-string keyed, same
  // as everywhere else productType is matched (Bill.productType/
  // RateHistory.productType are both plain strings, not a shared FK) — the
  // product picker below is a datalist against the SAME Item Master names
  // Rate Master entries are normally typed against, so this lines up in
  // practice.
  const currentRateByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const rate of computeCurrentRates(rateHistory)) map.set(rate.productType, rate.rate);
    return map;
  }, [rateHistory]);

  // Section [new] — amount/litres auto-calculate off each other once the
  // product's current rate is known: type one, the other fills in; edit it
  // again and it recalculates. Purely a client-side convenience — the
  // server still resolves rateApplied itself at save time (Section 7.4,
  // BillsService.create()) and both fields are freely editable afterward,
  // so a DSM/Accountant correcting either value by hand always wins over
  // whatever this last computed.
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

  // Product type is typically picked AFTER amount on this form (field
  // order below), so the rate often only becomes known here — recompute
  // litres from whatever amount is already entered, same direction as
  // typing amount first normally would.
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

  function handleAddLine(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = Number(draftAmount);
    if (!(parsedAmount > 0)) return;
    setLines((prev) => [
      ...prev,
      { localId: makeLocalId(), paymentType: draftType, amount: parsedAmount, direction: draftDirection },
    ]);
    setDraftAmount('');
  }

  function handleRemoveLine(localId: string) {
    setLines((prev) => prev.filter((line) => line.localId !== localId));
  }

  const hasCreditLine = lines.some((line) => line.paymentType === 'CREDIT');
  const needsQuickAdd = hasCreditLine && !customerId;

  const sumIn = lines.filter((l) => l.direction === 'IN').reduce((t, l) => t + l.amount, 0);
  const sumOut = lines.filter((l) => l.direction === 'OUT').reduce((t, l) => t + l.amount, 0);
  const parsedBillAmount = Number(amount) || 0;
  const remaining = parsedBillAmount - (sumIn - sumOut);
  const balanced = Math.abs(remaining) <= EPSILON;

  const hasVehicleOrName = vehicleNumber.trim() !== '' || customerName.trim() !== '';

  const canSave =
    !submitting &&
    hasVehicleOrName &&
    parsedBillAmount > 0 &&
    Number(litres) > 0 &&
    productType.trim() !== '' &&
    lines.length > 0 &&
    balanced &&
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
        paymentLines: lines.map(({ paymentType, amount: lineAmount, direction }) => ({
          paymentType,
          amount: lineAmount,
          direction,
        })),
      });
      onCreated(bill);
    } catch (err) {
      // Backend validation (Section 4's vehicle-or-name rule, Section
      // 5A.1's balance check, credit limit/blacklist enforcement) is the
      // real safeguard — we just surface whatever message it sends back.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>Add bill</h3>
        </div>

        <div className="form-field">
          <label htmlFor="ab-customer">Link to existing customer (optional)</label>
          <select id="ab-customer" value={customerId} onChange={(e) => handleSelectCustomer(e.target.value)}>
            <option value="">No linked customer / walk-in</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.vehicleNumber ? ` · ${customer.vehicleNumber}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="ab-customer-name">Customer name</label>
          <input
            id="ab-customer-name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Optional if vehicle number is set"
          />
        </div>
        <div className="form-field">
          <label htmlFor="ab-vehicle">Vehicle number</label>
          <input
            id="ab-vehicle"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
            placeholder="Optional if customer name is set"
          />
        </div>
        {!hasVehicleOrName && <div className="form-error">Vehicle number or customer name is required.</div>}

        <div className="form-field">
          <label htmlFor="ab-amount">Amount (Rs.)</label>
          <input
            id="ab-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="ab-litres">Litres</label>
          <input
            id="ab-litres"
            type="number"
            min="0"
            step="0.01"
            value={litres}
            onChange={(e) => handleLitresChange(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="ab-product">Product type</label>
          <input
            id="ab-product"
            list="ab-item-master"
            value={productType}
            onChange={(e) => handleProductTypeChange(e.target.value)}
            placeholder="e.g. Petrol, Diesel"
            required
          />
          <datalist id="ab-item-master">
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
          <label>Payments</label>
          <div className="section-note" style={{ marginBottom: 8 }}>
            Remaining to collect: Rs.{remaining.toFixed(2)} {balanced ? '(balanced)' : ''}
          </div>

          {lines.map((line) => (
            <div key={line.localId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>
                {line.paymentType} {line.direction === 'OUT' ? '(change)' : ''}: Rs.{line.amount.toFixed(2)}
              </span>
              <button type="button" className="btn-secondary" onClick={() => handleRemoveLine(line.localId)}>
                Remove
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
              <label htmlFor="ab-line-type">Type</label>
              <select id="ab-line-type" value={draftType} onChange={(e) => setDraftType(e.target.value as PaymentType)}>
                {PAYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'CARD' ? 'POS / card' : type[0] + type.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
              <label htmlFor="ab-line-amount">Amount</label>
              <input
                id="ab-line-amount"
                type="number"
                min="0"
                step="0.01"
                value={draftAmount}
                onChange={(e) => setDraftAmount(e.target.value)}
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
              <label htmlFor="ab-line-direction">Direction</label>
              <select
                id="ab-line-direction"
                value={draftDirection}
                onChange={(e) => setDraftDirection(e.target.value as PaymentDirection)}
              >
                <option value="IN">In (received)</option>
                <option value="OUT">Out (change given)</option>
              </select>
            </div>
            <button type="button" className="btn-secondary" onClick={handleAddLine} disabled={!(Number(draftAmount) > 0)}>
              Add
            </button>
          </div>
        </div>

        {needsQuickAdd && (
          <div className="form-field">
            <label>New credit customer (Section 3.4A quick-add)</label>
            <div className="section-note" style={{ marginBottom: 8 }}>
              This CREDIT payment has no linked customer — quick-add one now, or pick an existing customer above.
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

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={!canSave}>
            {submitting ? 'Saving…' : 'Add bill'}
          </button>
        </div>
      </form>
    </div>
  );
}
