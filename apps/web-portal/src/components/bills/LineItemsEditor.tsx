import { useEffect, useState, type FormEvent } from 'react';
import { getTaxRateConfigs } from '../../api/taxRateConfig';
import type { CreateBillLineItemRequest, Item } from '../../api/types';

// Extra (non-fuel) items on a bill — e.g. a can of engine oil handed over
// with the same fill-up (Multi-item bill grid, mirrors the Code/Item
// Name/Qty/Rate/Amount/tax layout of the legacy paper-form screenshot this
// feature was requested from). Shared between AddCreditBillModal and
// AddCashBillModal since the grid/tax rules are identical in both — only
// how the resulting grand total feeds into payment lines differs, which
// stays in each modal.
//
// Every amount computed here (amount, tax split, lineTotal) is a
// CLIENT-SIDE PREVIEW ONLY, purely so the dealer can see the total before
// saving — BillsService.resolveLineItem() recomputes and validates all of
// it authoritatively server-side (CLAUDE.md: never trust the frontend for
// money fields). GST is added on top of quantity × rate (confirmed product
// decision — not MRP-inclusive), split CGST+SGST for an intra-state line or
// charged wholly as IGST for inter-state. Fuel itself never gets a tax
// field here — fuel's rate is already tax-inclusive at the pump, unchanged
// by this feature.
export interface LocalLineItem {
  localId: string;
  itemId?: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  rate: number;
  isInterstate: boolean;
  taxRate: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function lineItemAmounts(line: LocalLineItem) {
  const amount = round2(line.quantity * line.rate);
  const taxAmount = round2(amount * (line.taxRate / 100));
  const cgstAmount = line.isInterstate ? 0 : round2(taxAmount / 2);
  const sgstAmount = line.isInterstate ? 0 : round2(taxAmount - cgstAmount);
  const igstAmount = line.isInterstate ? taxAmount : 0;
  const lineTotal = round2(amount + cgstAmount + sgstAmount + igstAmount);
  return { amount, cgstAmount, sgstAmount, igstAmount, lineTotal };
}

// Sums every line's preview amounts — itemsSubtotal (pre-tax) and
// itemsTaxTotal (cgst+sgst+igst across all lines) — for the caller to fold
// into its own grand total (fuelAmount + itemsSubtotal + itemsTaxTotal),
// same shape BillsService stores on Bill.
export function computeLineItemTotals(lines: LocalLineItem[]) {
  let itemsSubtotal = 0;
  let itemsTaxTotal = 0;
  for (const line of lines) {
    const { amount, cgstAmount, sgstAmount, igstAmount } = lineItemAmounts(line);
    itemsSubtotal += amount;
    itemsTaxTotal += cgstAmount + sgstAmount + igstAmount;
  }
  return { itemsSubtotal: round2(itemsSubtotal), itemsTaxTotal: round2(itemsTaxTotal) };
}

export function toCreateBillLineItemRequests(lines: LocalLineItem[]): CreateBillLineItemRequest[] {
  return lines.map((line) => ({
    itemId: line.itemId,
    itemCode: line.itemCode.trim() === '' ? undefined : line.itemCode.trim(),
    itemName: line.itemName.trim(),
    quantity: line.quantity,
    rate: line.rate,
    isInterstate: line.isInterstate,
    taxRate: line.taxRate,
  }));
}

let localIdCounter = 0;
function makeLocalId(): string {
  localIdCounter += 1;
  return `line-item-${localIdCounter}`;
}

interface LineItemsEditorProps {
  items: Item[];
  lines: LocalLineItem[];
  onChange: (lines: LocalLineItem[]) => void;
  idPrefix: string;
}

// Only non-fuel items make sense as an "extra" line alongside the fuel sale
// — the fuel sale itself is what the rest of the bill form already covers.
function nonFuelItems(items: Item[]): Item[] {
  return items.filter((item) => item.category !== 'FUEL');
}

export function LineItemsEditor({ items, lines, onChange, idPrefix }: LineItemsEditorProps) {
  const [draftItemName, setDraftItemName] = useState('');
  const [draftItemCode, setDraftItemCode] = useState('');
  const [draftQuantity, setDraftQuantity] = useState('');
  const [draftRate, setDraftRate] = useState('');
  const [draftInterstate, setDraftInterstate] = useState(false);
  const [draftTaxRate, setDraftTaxRate] = useState('');

  // Section 17.22 — the same dealer-configured per-productType GST rate the
  // sales/purchase register reads, reused here (keyed by item name) as the
  // default that prefills onto a new line, instead of a second Item-scoped
  // rate field that could drift out of sync with it. Exact same map the
  // server-side resolveLineItems() falls back to when a line omits its own
  // taxRate — this is a client-side preview of that lookup, not a separate
  // source of truth.
  const [taxRateByProduct, setTaxRateByProduct] = useState<Record<string, number>>({});

  useEffect(() => {
    getTaxRateConfigs()
      .then((rows) => setTaxRateByProduct(Object.fromEntries(rows.map((row) => [row.productType, row.taxRatePercent]))))
      .catch(() => undefined);
  }, []);

  const pickableItems = nonFuelItems(items);

  function handleDraftItemNameChange(value: string) {
    setDraftItemName(value);
    const matched = pickableItems.find((item) => item.name.toLowerCase() === value.trim().toLowerCase());
    if (matched) {
      setDraftItemCode(matched.code ?? '');
      const configuredRate = taxRateByProduct[matched.name];
      if (configuredRate !== undefined) setDraftTaxRate(String(configuredRate));
    }
  }

  function handleAddLine(event: FormEvent) {
    event.preventDefault();
    const quantity = Number(draftQuantity);
    const rate = Number(draftRate);
    if (!(quantity > 0) || !(rate > 0) || draftItemName.trim() === '') return;

    const matched = pickableItems.find(
      (item) => item.name.toLowerCase() === draftItemName.trim().toLowerCase(),
    );

    onChange([
      ...lines,
      {
        localId: makeLocalId(),
        itemId: matched?.id,
        itemCode: draftItemCode.trim(),
        itemName: draftItemName.trim(),
        quantity,
        rate,
        isInterstate: draftInterstate,
        taxRate: draftTaxRate.trim() === '' ? 0 : Number(draftTaxRate),
      },
    ]);
    setDraftItemName('');
    setDraftItemCode('');
    setDraftQuantity('');
    setDraftRate('');
    setDraftInterstate(false);
    setDraftTaxRate('');
  }

  function handleRemoveLine(localId: string) {
    onChange(lines.filter((line) => line.localId !== localId));
  }

  return (
    <div className="form-field">
      <label>Extra items (lubricants, oil, etc. — optional)</label>
      <div className="section-note" style={{ marginBottom: 8 }}>
        GST is added on top of quantity × rate; fuel itself is never taxed here — its rate already
        includes VAT.
      </div>

      {lines.length > 0 && (
        <div className="table-card" style={{ marginBottom: 8 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
                <th className="num">Tax %</th>
                <th className="num">CGST</th>
                <th className="num">SGST</th>
                <th className="num">IGST</th>
                <th className="num">Line total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const totals = lineItemAmounts(line);
                return (
                  <tr key={line.localId}>
                    <td>{line.itemCode || '—'}</td>
                    <td>{line.itemName}</td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{line.rate.toFixed(2)}</td>
                    <td className="num">{totals.amount.toFixed(2)}</td>
                    <td className="num">{line.taxRate}%{line.isInterstate ? ' (IGST)' : ''}</td>
                    <td className="num">{totals.cgstAmount.toFixed(2)}</td>
                    <td className="num">{totals.sgstAmount.toFixed(2)}</td>
                    <td className="num">{totals.igstAmount.toFixed(2)}</td>
                    <td className="num">{totals.lineTotal.toFixed(2)}</td>
                    <td>
                      <button type="button" className="btn-secondary" onClick={() => handleRemoveLine(line.localId)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-field" style={{ marginBottom: 0, flex: '1 1 160px' }}>
          <label htmlFor={`${idPrefix}-li-name`}>Item</label>
          <input
            id={`${idPrefix}-li-name`}
            list={`${idPrefix}-li-item-master`}
            value={draftItemName}
            onChange={(e) => handleDraftItemNameChange(e.target.value)}
            placeholder="e.g. Engine Oil 1L"
          />
          <datalist id={`${idPrefix}-li-item-master`}>
            {pickableItems.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </div>
        <div className="form-field" style={{ marginBottom: 0, flex: '0 1 90px' }}>
          <label htmlFor={`${idPrefix}-li-code`}>Code</label>
          <input id={`${idPrefix}-li-code`} value={draftItemCode} onChange={(e) => setDraftItemCode(e.target.value)} />
        </div>
        <div className="form-field" style={{ marginBottom: 0, flex: '0 1 80px' }}>
          <label htmlFor={`${idPrefix}-li-qty`}>Qty</label>
          <input
            id={`${idPrefix}-li-qty`}
            type="number"
            min="0"
            step="0.01"
            value={draftQuantity}
            onChange={(e) => setDraftQuantity(e.target.value)}
          />
        </div>
        <div className="form-field" style={{ marginBottom: 0, flex: '0 1 90px' }}>
          <label htmlFor={`${idPrefix}-li-rate`}>Rate</label>
          <input
            id={`${idPrefix}-li-rate`}
            type="number"
            min="0"
            step="0.01"
            value={draftRate}
            onChange={(e) => setDraftRate(e.target.value)}
          />
        </div>
        <div className="form-field" style={{ marginBottom: 0, flex: '0 1 80px' }}>
          <label htmlFor={`${idPrefix}-li-tax`}>Tax %</label>
          <input
            id={`${idPrefix}-li-tax`}
            type="number"
            min="0"
            step="0.01"
            value={draftTaxRate}
            onChange={(e) => setDraftTaxRate(e.target.value)}
          />
        </div>
        <div className="form-field" style={{ marginBottom: 0, flex: '0 0 auto' }}>
          <label htmlFor={`${idPrefix}-li-interstate`}>Interstate</label>
          <input
            id={`${idPrefix}-li-interstate`}
            type="checkbox"
            checked={draftInterstate}
            onChange={(e) => setDraftInterstate(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleAddLine}
          disabled={!(Number(draftQuantity) > 0) || !(Number(draftRate) > 0) || draftItemName.trim() === ''}
        >
          Add item
        </button>
      </div>
    </div>
  );
}
