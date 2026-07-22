import { useEffect, useState, type FormEvent } from 'react';
import { createItem, getItems, updateItem } from '../../api/items';
import { StatusBadge } from '../common/StatusBadge';
import { ApiError } from '../../api/client';
import type { Item, ItemCategory, ItemUnit } from '../../api/types';

interface ItemSettingsProps {
  canManage: boolean;
}

const CATEGORIES: ItemCategory[] = ['FUEL', 'LUBRICANT', 'OTHER'];
const UNITS: ItemUnit[] = ['LITRE', 'KG', 'PIECE'];

// Item Master — the single place an Owner/Manager/Accountant registers
// everything this pump sells: Petrol, Diesel, Speed, Urea/AdBlue, lubricant
// SKUs, and anything else. Nozzle setup (below this section in Settings)
// reads this list for its item dropdown instead of a free-text field.
//
// canManage gates create/edit — the backend allows Owner/Accountant/Manager
// (wider than Nozzle/Tank setup's Owner/Accountant, per explicit product
// direction that Managers should be able to maintain this list); everyone
// else sees it read-only, same pattern as the other Settings sections.
export function ItemSettings({ canManage }: ItemSettingsProps) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory>('FUEL');
  const [unit, setUnit] = useState<ItemUnit>('LITRE');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<ItemCategory>('FUEL');
  const [editUnit, setEditUnit] = useState<ItemUnit>('LITRE');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function loadItems() {
    // includeInactive: true — this Settings screen must be able to find
    // and re-enable a disabled item, unlike every other dropdown that reads
    // GET /items (those default to active-only).
    return getItems(true)
      .then((result) => {
        setItems(result);
        setLoadError(null);
        return result;
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        return null;
      });
  }

  useEffect(() => {
    let cancelled = false;
    getItems(true)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      await createItem({ name: name.trim(), category, unit });
      setName('');
      setCategory('FUEL');
      setUnit('LITRE');
      await loadItems();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: Item) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditCategory(item.category);
    setEditUnit(item.unit);
    setEditError(null);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      await updateItem(editingId, { name: editName.trim(), category: editCategory, unit: editUnit });
      setEditingId(null);
      await loadItems();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleActive(item: Item) {
    try {
      await updateItem(item.id, { isActive: !item.isActive });
      await loadItems();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        <h3>Item master</h3>
        <span className="section-note">
          Everything this pump sells — Petrol, Diesel, Speed, Urea/AdBlue, lubricant SKUs, or anything
          else. Nozzle setup below reads this list instead of a free-text product field.
        </span>
      </div>

      {loadError && <div className="error-box">{loadError}</div>}
      {!loadError && !items && <div className="loading">Loading items&hellip;</div>}

      {!loadError && items && (
        items.length === 0 ? (
          <div className="empty-box">No items registered yet — add this pump&rsquo;s first item below.</div>
        ) : (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th>Status</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) =>
                  editingId === item.id ? (
                    <tr key={item.id}>
                      <td colSpan={canManage ? 5 : 4}>
                        <form
                          onSubmit={(e) => {
                            void handleSaveEdit(e);
                          }}
                          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Name"
                            required
                            style={{ width: 140 }}
                          />
                          <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as ItemCategory)}>
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          <select value={editUnit} onChange={(e) => setEditUnit(e.target.value as ItemUnit)}>
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
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
                    <tr key={item.id}>
                      <td style={{ fontWeight: 700 }}>{item.name}</td>
                      <td>{item.category}</td>
                      <td>{item.unit}</td>
                      <td>
                        <StatusBadge tone={item.isActive ? 'good' : 'neutral'} label={item.isActive ? 'Active' : 'Disabled'} />
                      </td>
                      {canManage && (
                        <td className="chevron">
                          <button type="button" className="icon-btn" onClick={() => startEdit(item)}>
                            Edit
                          </button>{' '}
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => {
                              void handleToggleActive(item);
                            }}
                          >
                            {item.isActive ? 'Disable' : 'Enable'}
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
        <form
          onSubmit={(e) => {
            void handleAdd(e);
          }}
          style={{ marginTop: 16 }}
        >
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="item-name">Name</label>
              <input
                id="item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Petrol, Urea/AdBlue"
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="item-category">Category</label>
              <select id="item-category" value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="item-unit">Unit</label>
              <select id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value as ItemUnit)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {addError && <div className="form-error">{addError}</div>}
          <div className="modal-actions">
            <button type="submit" className="export-btn" disabled={adding}>
              {adding ? 'Adding…' : '+ Add item'}
            </button>
          </div>
        </form>
      ) : (
        <div className="section-note">
          Only the Owner/Accountant/Manager can add or edit items — this view is read-only for your role.
        </div>
      )}
    </div>
  );
}
