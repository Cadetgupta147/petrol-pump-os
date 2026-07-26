import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { createItemSale, getItemSales } from '../api/itemSales';
import { getItems } from '../api/items';
import { getLubricantItems } from '../api/lubricantItems';
import { ApiError } from '../api/client';
import { formatRupees, formatDateTime } from '../utils/format';
import type { CreateItemSaleRequest, Item, ItemSale, LubricantItem, PaymentType } from '../api/types';

const PAYMENT_TYPES: PaymentType[] = ['CASH', 'CARD', 'UPI', 'CREDIT'];

// Dashboard "Not wired to a backend endpoint yet" panel items #1/#2 —
// "Lubricant sale" and "Urea/DEF sale". One page for both — see the schema
// comment on ItemSale for why they're the same underlying feature.
// FUEL-category items are excluded from the picker (the backend rejects
// them anyway — fuel sales go through meter reading/billing).
export function ItemSalesPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [lubricantItems, setLubricantItems] = useState<LubricantItem[]>([]);
  const [sales, setSales] = useState<ItemSale[] | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);

  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('CASH');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const sellableItems = useMemo(
    () => items.filter((item) => item.category === 'LUBRICANT' || item.category === 'OTHER'),
    [items],
  );

  useEffect(() => {
    let cancelled = false;
    getItems()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => undefined);
    getLubricantItems()
      .then((result) => {
        if (!cancelled) setLubricantItems(result);
      })
      .catch(() => undefined);
    getItemSales()
      .then((result) => {
        if (!cancelled) setSales(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setSalesError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-fill unit price from the item's configured lubricant sale price, if
  // it has one — the field stays editable (a counter discount/markup is a
  // real, common case), this is just a starting point.
  function handleItemChange(nextItemId: string) {
    setItemId(nextItemId);
    const configured = lubricantItems.find((li) => li.itemId === nextItemId);
    if (configured) {
      setUnitPrice(String(configured.salePrice));
    }
  }

  function resetForm() {
    setItemId('');
    setQuantity('');
    setUnitPrice('');
    setPaymentType('CASH');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      const dto: CreateItemSaleRequest = {
        itemId,
        quantity: Number(quantity.trim()),
        unitPrice: Number(unitPrice.trim()),
        paymentType,
      };
      const created = await createItemSale(dto);
      setSales((prev) => (prev ? [created, ...prev] : [created]));
      resetForm();
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      // Covers the 404 (unknown item / lubricant stock not configured), 400
      // (FUEL-category item), and 409 (insufficient stock) cases directly
      // (ItemSalesService.create()) — surfaced verbatim.
      setSaveError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>New lubricant / Urea-DEF sale</h3>
          <span className="section-note">POST /item-sales — decrements lubricant stock, no stock effect for other items</span>
        </div>

        <div className="section">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="grid grid-2">
              <div className="form-field">
                <label htmlFor="is-item">Item</label>
                <select
                  id="is-item"
                  value={itemId}
                  onChange={(e) => handleItemChange(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    {sellableItems.length === 0
                      ? 'No LUBRICANT/OTHER items registered — add one in Settings first'
                      : 'Select an item'}
                  </option>
                  {sellableItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.category})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="is-quantity">Quantity</label>
                <input
                  id="is-quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="is-unit-price">Unit price (Rs.)</label>
                <input
                  id="is-unit-price"
                  type="number"
                  min="0"
                  step="any"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="is-payment">Payment type</label>
                <select
                  id="is-payment"
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                >
                  {PAYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {quantity.trim() !== '' && unitPrice.trim() !== '' && (
              <div className="section-note">
                Amount: {formatRupees(Number(quantity.trim()) * Number(unitPrice.trim()))}
              </div>
            )}

            {saveError && <div className="form-error">{saveError}</div>}
            {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={resetForm} disabled={saving}>
                Clear form
              </button>
              <button type="submit" className="export-btn" disabled={saving || !itemId}>
                {saving ? 'Saving…' : 'Save sale'}
              </button>
            </div>
          </form>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Lubricant / Urea-DEF sales</h3>
            <span className="section-note">GET /item-sales — most recent first</span>
          </div>
          {salesError && <div className="error-box">{salesError}</div>}
          {!salesError && !sales && <div className="loading">Loading sales…</div>}
          {!salesError && sales && sales.length === 0 && (
            <div className="empty-box">No sales recorded yet.</div>
          )}
          {!salesError && sales && sales.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Quantity</th>
                    <th className="num">Unit price</th>
                    <th className="num">Amount</th>
                    <th>Payment</th>
                    <th>Sold at</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{sale.item.name}</td>
                      <td className="num">{sale.quantity}</td>
                      <td className="num">{formatRupees(sale.unitPrice)}</td>
                      <td className="num">{formatRupees(sale.amount)}</td>
                      <td>{sale.paymentType}</td>
                      <td>{formatDateTime(sale.soldAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
