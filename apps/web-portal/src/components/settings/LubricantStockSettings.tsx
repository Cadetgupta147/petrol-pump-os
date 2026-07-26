import { useEffect, useState, type FormEvent } from 'react';
import { getItems } from '../../api/items';
import { createLubricantItem, getLubricantItems, updateLubricantItem } from '../../api/lubricantItems';
import { ApiError } from '../../api/client';
import { formatRupees } from '../../utils/format';
import type { Item, LubricantItem } from '../../api/types';

interface LubricantStockSettingsProps {
  canManage: boolean;
}

// Dashboard "Not wired to a backend endpoint yet" panel item #1 —
// "Lubricant sale" ("LubricantItem exists in the schema (stock only, no
// sale-price/SKU fields), but zero service or controller exists anywhere
// for it"). This is the SKU/pricing/stock half of that gap — a lubricant
// must already exist as an Item Master entry with category LUBRICANT
// (Item Settings above) before it can get a stock/pricing row here.
export function LubricantStockSettings({ canManage }: LubricantStockSettingsProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [lubricantItems, setLubricantItems] = useState<LubricantItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [itemId, setItemId] = useState('');
  const [sku, setSku] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [stockQty, setStockQty] = useState('');
  const [reorderAt, setReorderAt] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStockQty, setEditStockQty] = useState('');
  const [editSalePrice, setEditSalePrice] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function load() {
    getItems(true)
      .then(setItems)
      .catch(() => undefined);
    return getLubricantItems()
      .then((result) => {
        setLubricantItems(result);
        setLoadError(null);
        return result;
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        return null;
      });
  }

  useEffect(() => {
    void load();
  }, []);

  // Only LUBRICANT-category items that don't already have a stock/pricing
  // row are offered here — that's exactly what LubricantItemsService.create()
  // requires (category check) and enforces (itemId is @unique).
  const configuredItemIds = new Set((lubricantItems ?? []).map((li) => li.itemId));
  const unconfiguredLubricantItems = items.filter(
    (item) => item.category === 'LUBRICANT' && !configuredItemIds.has(item.id),
  );

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      await createLubricantItem({
        itemId,
        sku: sku.trim() === '' ? undefined : sku.trim(),
        costPrice: costPrice.trim() === '' ? undefined : Number(costPrice.trim()),
        salePrice: Number(salePrice.trim()),
        stockQty: Number(stockQty.trim()),
        reorderAt: Number(reorderAt.trim()),
      });
      setItemId('');
      setSku('');
      setCostPrice('');
      setSalePrice('');
      setStockQty('');
      setReorderAt('');
      await load();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(li: LubricantItem) {
    setEditingId(li.id);
    setEditStockQty(String(li.stockQty));
    setEditSalePrice(String(li.salePrice));
    setEditError(null);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      await updateLubricantItem(editingId, {
        stockQty: Number(editStockQty.trim()),
        salePrice: Number(editSalePrice.trim()),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        <h3>Lubricant stock &amp; pricing</h3>
        <span className="section-note">
          SKU, cost/sale price, quantity, and reorder threshold for a LUBRICANT-category item — see
          Item master above to register the item itself first.
        </span>
      </div>

      {loadError && <div className="error-box">{loadError}</div>}
      {!loadError && !lubricantItems && <div className="loading">Loading lubricant stock…</div>}

      {!loadError && lubricantItems && (
        lubricantItems.length === 0 ? (
          <div className="empty-box">No lubricant stock/pricing configured yet.</div>
        ) : (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th className="num">Cost price</th>
                  <th className="num">Sale price</th>
                  <th className="num">Stock</th>
                  <th className="num">Reorder at</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {lubricantItems.map((li) =>
                  editingId === li.id ? (
                    <tr key={li.id}>
                      <td colSpan={canManage ? 7 : 6}>
                        <form
                          onSubmit={(e) => { void handleSaveEdit(e); }}
                          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <span>{li.item.name}</span>
                          <input
                            type="number" min="0" step="any"
                            value={editSalePrice}
                            onChange={(e) => setEditSalePrice(e.target.value)}
                            placeholder="Sale price"
                            required
                            style={{ width: 100 }}
                          />
                          <input
                            type="number" min="0"
                            value={editStockQty}
                            onChange={(e) => setEditStockQty(e.target.value)}
                            placeholder="Stock qty"
                            required
                            style={{ width: 100 }}
                          />
                          <button type="submit" className="export-btn" disabled={savingEdit}>
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setEditingId(null)}
                            disabled={savingEdit}
                          >
                            Cancel
                          </button>
                        </form>
                        {editError && <div className="form-error">{editError}</div>}
                      </td>
                    </tr>
                  ) : (
                    <tr key={li.id}>
                      <td style={{ fontWeight: 700 }}>{li.item.name}</td>
                      <td>{li.sku ?? '—'}</td>
                      <td className="num">{li.costPrice !== null ? formatRupees(li.costPrice) : '—'}</td>
                      <td className="num">{formatRupees(li.salePrice)}</td>
                      <td className="num">{li.stockQty}</td>
                      <td className="num">{li.reorderAt}</td>
                      {canManage && (
                        <td className="chevron">
                          <button type="button" className="icon-btn" onClick={() => startEdit(li)}>
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {canManage ? (
        <form onSubmit={(e) => { void handleAdd(e); }} style={{ marginTop: 16 }}>
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="li-item">Item</label>
              <select id="li-item" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
                <option value="" disabled>
                  {unconfiguredLubricantItems.length === 0
                    ? 'No unconfigured LUBRICANT items — add one in Item master above'
                    : 'Select a LUBRICANT item'}
                </option>
                {unconfiguredLubricantItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="li-sku">SKU</label>
              <input id="li-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="li-cost">Cost price (Rs.)</label>
              <input
                id="li-cost" type="number" min="0" step="any"
                value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="li-sale">Sale price (Rs.)</label>
              <input
                id="li-sale" type="number" min="0" step="any"
                value={salePrice} onChange={(e) => setSalePrice(e.target.value)}
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="li-stock">Stock quantity</label>
              <input
                id="li-stock" type="number" min="0"
                value={stockQty} onChange={(e) => setStockQty(e.target.value)}
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="li-reorder">Reorder at</label>
              <input
                id="li-reorder" type="number" min="0"
                value={reorderAt} onChange={(e) => setReorderAt(e.target.value)}
                required
              />
            </div>
          </div>
          {addError && <div className="form-error">{addError}</div>}
          <div className="modal-actions">
            <button type="submit" className="export-btn" disabled={adding || !itemId}>
              {adding ? 'Adding…' : '+ Add lubricant stock'}
            </button>
          </div>
        </form>
      ) : (
        <div className="section-note">
          Only the Owner/Accountant/Manager can add or edit lubricant stock — this view is read-only
          for your role.
        </div>
      )}
    </div>
  );
}
