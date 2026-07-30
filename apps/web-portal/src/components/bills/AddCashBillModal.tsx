import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createBill } from '../../api/bills';
import { getItems } from '../../api/items';
import { getRateHistory } from '../../api/rateMaster';
import { computeCurrentRates } from '../../utils/rateMaster';
import { localIsoDate } from '../../utils/format';
import { ApiError } from '../../api/client';
import type { Bill, Customer, Item, PaymentDirection, PaymentType, RateHistory } from '../../api/types';
import { LineItemsEditor, computeLineItemTotals, toCreateBillLineItemRequests, type LocalLineItem } from './LineItemsEditor';

interface AddCashBillModalProps {
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
//
// This is the "general" bill-entry path — one or more payment lines across
// CASH/CARD/UPI, with CREDIT still available as one of several split lines
// (Section 5A.2: "a regular walk-in pays cash and puts the rest on their
// running tab" is a real, supported case, not something this flow forbids).
// A bill that's paid ENTIRELY on credit has its own fast path instead —
// AddCreditBillModal — which skips the payment-line UI entirely since the
// answer is always "one CREDIT line for the full amount." Both post to the
// same POST /bills endpoint and go through the identical
// BillsService.create() validation; this split is a front-end convenience
// only, not a different backend code path.
//
// Layout takes inspiration from a dense legacy pump-billing screen: a wide,
// single-screen form (`.modal-card.wide`) with compact identity fields up
// top, one dominant spreadsheet-style item grid (LineItemsEditor — fuel as
// its first row, extra items below), a payment-lines breakdown, and a
// prominent total bar next to Cancel/Save at the bottom, restyled with this
// app's own tokens/components rather than copied wholesale.
export function AddCashBillModal({ customers, onClose, onCreated }: AddCashBillModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [productType, setProductType] = useState('');
  // Defaults to today (Section: backdating) — editable so a bill can be
  // entered for a past day instead of always silently landing on today's
  // date (Bill.timestamp otherwise only ever defaults to now()).
  const [billDate, setBillDate] = useState(() => localIsoDate());
  const [items, setItems] = useState<Item[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);
  const [lineItems, setLineItems] = useState<LocalLineItem[]>([]);

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
  const parsedFuelAmount = Number(amount) || 0;
  const { itemsSubtotal, itemsTaxTotal } = computeLineItemTotals(lineItems);
  // Grand total — what the customer actually owes and what the payment
  // lines below must balance to (Section 5A.1), not just the fuel amount.
  const grandTotal = Math.round((parsedFuelAmount + itemsSubtotal + itemsTaxTotal) * 100) / 100;
  const remaining = grandTotal - (sumIn - sumOut);
  const balanced = Math.abs(remaining) <= EPSILON;

  const hasVehicleOrName = vehicleNumber.trim() !== '' || customerName.trim() !== '';

  const canSave =
    !submitting &&
    hasVehicleOrName &&
    parsedFuelAmount > 0 &&
    Number(litres) > 0 &&
    productType.trim() !== '' &&
    billDate.trim() !== '' &&
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
        amount: grandTotal,
        litres: Number(litres),
        productType: productType.trim(),
        entryChannel: 'WEB',
        billDate,
        paymentLines: lines.map(({ paymentType, amount: lineAmount, direction }) => ({
          paymentType,
          amount: lineAmount,
          direction,
        })),
        lineItems: lineItems.length > 0 ? toCreateBillLineItemRequests(lineItems) : undefined,
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
      <form className="modal-card wide" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>Add cash / split-payment bill</h3>
          <span className="section-note">
            For a bill paid entirely on credit, use &ldquo;Add credit bill&rdquo; instead — no payment
            breakdown needed there.
          </span>
        </div>

        <div className="bill-header-grid" style={{ marginBottom: 14 }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
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
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="ab-customer-name">Customer name</label>
            <input
              id="ab-customer-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Optional if vehicle number is set"
            />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="ab-vehicle">Vehicle number</label>
            <input
              id="ab-vehicle"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              placeholder="Optional if customer name is set"
            />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="ab-date">Bill date</label>
            <input
              id="ab-date"
              type="date"
              value={billDate}
              max={localIsoDate()}
              onChange={(e) => setBillDate(e.target.value)}
              required
            />
          </div>
        </div>
        {!hasVehicleOrName && <div className="form-error">Vehicle number or customer name is required.</div>}

        <LineItemsEditor
          items={items}
          lines={lineItems}
          onChange={setLineItems}
          idPrefix="ab"
          fuel={{
            productType,
            onProductTypeChange: handleProductTypeChange,
            litres,
            onLitresChange: handleLitresChange,
            amount,
            onAmountChange: handleAmountChange,
            resolvedRate,
          }}
        />

        <div className="form-field" style={{ marginTop: 14 }}>
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
            <div className="bill-header-grid">
              <input
                value={quickAddName}
                onChange={(e) => setQuickAddName(e.target.value)}
                placeholder="Name"
              />
              <input
                value={quickAddVehicle}
                onChange={(e) => setQuickAddVehicle(e.target.value)}
                placeholder="Vehicle number"
              />
            </div>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="bill-total-bar">
          <div className="bill-total-bar-breakdown">
            Fuel Rs.{parsedFuelAmount.toFixed(2)}
            {lineItems.length > 0 && (
              <> + items Rs.{itemsSubtotal.toFixed(2)} + tax Rs.{itemsTaxTotal.toFixed(2)}</>
            )}
          </div>
          <div className="bill-total-bar-value">Rs.{grandTotal.toFixed(2)}</div>
        </div>

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
