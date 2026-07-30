import { useEffect, useState } from 'react';
import { getTaxRateConfigs } from '../../api/taxRateConfig';
import type { CreateBillLineItemRequest, Item } from '../../api/types';

// The bill's full item grid — fuel (via the `fuel` prop, driven by the
// parent modal's own amount/litres/productType state) as the first row,
// then any extra non-fuel items below, all rendered as ONE continuous,
// Excel-style bordered table. Inspired by a dense legacy pump-billing
// layout (single screen, one dominant item grid rather than a form with a
// list bolted underneath) restyled with this app's own tokens/components.
// Shared between AddCreditBillModal and AddCashBillModal — the grid/tax
// rules are identical in both; only how the resulting grand total feeds
// into payment lines differs, which stays in each modal.
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

function emptyDraftLine(): LocalLineItem {
  return {
    localId: makeLocalId(),
    itemCode: '',
    itemName: '',
    quantity: 0,
    rate: 0,
    isInterstate: false,
    taxRate: 0,
  };
}

// The fuel sale itself — driven by the parent modal's existing amount/
// litres/productType state and its rate-master auto-fill handlers; rendered
// as the grid's first row purely for visual continuity with the extra
// items below, not a separate data model.
export interface FuelRowProps {
  productType: string;
  onProductTypeChange: (value: string) => void;
  litres: string;
  onLitresChange: (value: string) => void;
  amount: string;
  onAmountChange: (value: string) => void;
  resolvedRate: number | undefined;
}

interface LineItemsEditorProps {
  items: Item[];
  lines: LocalLineItem[];
  onChange: (lines: LocalLineItem[]) => void;
  idPrefix: string;
  fuel: FuelRowProps;
}

// Only non-fuel items make sense as an "extra" line alongside the fuel sale.
function nonFuelItems(items: Item[]): Item[] {
  return items.filter((item) => item.category !== 'FUEL');
}

export function LineItemsEditor({ items, lines, onChange, idPrefix, fuel }: LineItemsEditorProps) {
  const [draft, setDraft] = useState<LocalLineItem>(emptyDraftLine);

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
  const fuelAmountNumber = Number(fuel.amount) || 0;

  function matchItem(name: string): Item | undefined {
    return pickableItems.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
  }

  function updateLine(localId: string, patch: Partial<LocalLineItem>) {
    onChange(lines.map((line) => (line.localId === localId ? { ...line, ...patch } : line)));
  }

  function updateLineName(localId: string, name: string) {
    const matched = matchItem(name);
    const patch: Partial<LocalLineItem> = { itemName: name, itemId: matched?.id };
    if (matched) {
      patch.itemCode = matched.code ?? '';
      const configuredRate = taxRateByProduct[matched.name];
      if (configuredRate !== undefined) patch.taxRate = configuredRate;
    }
    updateLine(localId, patch);
  }

  function handleRemoveLine(localId: string) {
    onChange(lines.filter((line) => line.localId !== localId));
  }

  function updateDraft(patch: Partial<LocalLineItem>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function updateDraftName(name: string) {
    const matched = matchItem(name);
    const patch: Partial<LocalLineItem> = { itemName: name, itemId: matched?.id };
    if (matched) {
      patch.itemCode = matched.code ?? '';
      const configuredRate = taxRateByProduct[matched.name];
      if (configuredRate !== undefined) patch.taxRate = configuredRate;
    }
    updateDraft(patch);
  }

  const canAddDraft = draft.quantity > 0 && draft.rate > 0 && draft.itemName.trim() !== '';

  function handleAddDraft() {
    if (!canAddDraft) return;
    onChange([...lines, { ...draft, itemCode: draft.itemCode.trim(), itemName: draft.itemName.trim() }]);
    setDraft(emptyDraftLine());
  }

  return (
    <div className="form-field">
      <label>Items</label>
      <div className="section-note" style={{ marginBottom: 8 }}>
        Fuel is already tax-inclusive (no tax columns for it). Extra items — lubricants, oil, etc. —
        carry GST added on top of quantity × rate; the code/tax % default from Item Master and the GST
        settings but stay editable per row.
      </div>

      <div className="table-card" style={{ marginBottom: 0, padding: 0 }}>
        <table className="billing-grid-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Item name</th>
              <th className="num">Qty</th>
              <th className="num">Rate</th>
              <th className="num">Amount</th>
              <th className="num">Tax %</th>
              <th>Interstate</th>
              <th className="num">CGST</th>
              <th className="num">SGST</th>
              <th className="num">IGST</th>
              <th className="num">Line total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr className="fuel-row">
              <td className="readonly-cell">—</td>
              <td>
                <input
                  list={`${idPrefix}-fuel-item-master`}
                  value={fuel.productType}
                  onChange={(e) => fuel.onProductTypeChange(e.target.value)}
                  placeholder="e.g. Petrol, Diesel"
                  required
                />
                <datalist id={`${idPrefix}-fuel-item-master`}>
                  {items.map((item) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
              </td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fuel.litres}
                  onChange={(e) => fuel.onLitresChange(e.target.value)}
                  required
                />
              </td>
              <td className="num readonly-cell">{fuel.resolvedRate ? fuel.resolvedRate.toFixed(2) : '—'}</td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fuel.amount}
                  onChange={(e) => fuel.onAmountChange(e.target.value)}
                  required
                />
              </td>
              <td className="num readonly-cell">—</td>
              <td className="readonly-cell">—</td>
              <td className="num readonly-cell">—</td>
              <td className="num readonly-cell">—</td>
              <td className="num readonly-cell">—</td>
              <td className="num readonly-cell">{fuelAmountNumber.toFixed(2)}</td>
              <td></td>
            </tr>

            {lines.map((line) => {
              const totals = lineItemAmounts(line);
              return (
                <tr key={line.localId}>
                  <td>
                    <input value={line.itemCode} onChange={(e) => updateLine(line.localId, { itemCode: e.target.value })} />
                  </td>
                  <td>
                    <input
                      list={`${idPrefix}-li-item-master`}
                      value={line.itemName}
                      onChange={(e) => updateLineName(line.localId, e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.quantity || ''}
                      onChange={(e) => updateLine(line.localId, { quantity: Number(e.target.value) })}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.rate || ''}
                      onChange={(e) => updateLine(line.localId, { rate: Number(e.target.value) })}
                    />
                  </td>
                  <td className="num readonly-cell">{totals.amount.toFixed(2)}</td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.taxRate || ''}
                      onChange={(e) => updateLine(line.localId, { taxRate: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={line.isInterstate}
                      onChange={(e) => updateLine(line.localId, { isInterstate: e.target.checked })}
                    />
                  </td>
                  <td className="num readonly-cell">{totals.cgstAmount.toFixed(2)}</td>
                  <td className="num readonly-cell">{totals.sgstAmount.toFixed(2)}</td>
                  <td className="num readonly-cell">{totals.igstAmount.toFixed(2)}</td>
                  <td className="num readonly-cell">{totals.lineTotal.toFixed(2)}</td>
                  <td>
                    <button
                      type="button"
                      className="row-remove-btn"
                      onClick={() => handleRemoveLine(line.localId)}
                      title="Remove item"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}

            <tr className="add-row">
              <td>
                <input value={draft.itemCode} onChange={(e) => updateDraft({ itemCode: e.target.value })} placeholder="Code" />
              </td>
              <td>
                <input
                  list={`${idPrefix}-li-item-master`}
                  value={draft.itemName}
                  onChange={(e) => updateDraftName(e.target.value)}
                  placeholder="e.g. Engine Oil 1L"
                />
                <datalist id={`${idPrefix}-li-item-master`}>
                  {pickableItems.map((item) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
              </td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.quantity || ''}
                  onChange={(e) => updateDraft({ quantity: Number(e.target.value) })}
                  placeholder="Qty"
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.rate || ''}
                  onChange={(e) => updateDraft({ rate: Number(e.target.value) })}
                  placeholder="Rate"
                />
              </td>
              <td className="num readonly-cell">{canAddDraft ? lineItemAmounts(draft).amount.toFixed(2) : '—'}</td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.taxRate || ''}
                  onChange={(e) => updateDraft({ taxRate: Number(e.target.value) })}
                  placeholder="Tax %"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={draft.isInterstate}
                  onChange={(e) => updateDraft({ isInterstate: e.target.checked })}
                />
              </td>
              <td className="num readonly-cell" colSpan={4}></td>
              <td>
                <button type="button" className="row-add-btn" onClick={handleAddDraft} disabled={!canAddDraft}>
                  + Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
