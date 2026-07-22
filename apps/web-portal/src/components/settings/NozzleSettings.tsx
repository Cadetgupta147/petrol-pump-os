import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createNozzle, getNozzles, updateNozzle } from '../../api/nozzles';
import { getTanks } from '../../api/tanks';
import { ApiError } from '../../api/client';
import type { Nozzle, Tank } from '../../api/types';

interface NozzleSettingsProps {
  canManage: boolean;
}

// Section 3.3/4 — Settings: "how many nozzles/meters does this pump have."
// Deliberately just an open-ended list, not a fixed count — different pumps
// have different physical nozzle/gun counts, so a dealer adds exactly as
// many as theirs actually has. Every nozzle picker elsewhere in this app
// (this app's own meter-readings page, the DSM app's shift start/close
// screens) reads GET /nozzles and renders a dropdown over these rows —
// nothing is ever free-typed again once a nozzle exists here.
//
// canManage gates create/edit to Owner/Accountant (mirrors the backend's
// @Roles(Role.OWNER, Role.ACCOUNTANT) on NozzlesController) — everyone else
// who reaches Settings sees the list read-only, same pattern as the
// Business profile section above this one.
export function NozzleSettings({ canManage }: NozzleSettingsProps) {
  const [nozzles, setNozzles] = useState<Nozzle[] | null>(null);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [productType, setProductType] = useState('');
  const [startingReading, setStartingReading] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editProductType, setEditProductType] = useState('');
  const [editStartingReading, setEditStartingReading] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Distinct product types already configured as tanks (Section 7.1) — used
  // as a datalist so the free-text productType field still autocompletes
  // toward a value the shift-close tank auto-deduct can actually match,
  // without forcing a hardcoded product enum here (see OpenShiftModal's
  // older equivalent for the same reasoning).
  const knownProductTypes = useMemo(
    () => Array.from(new Set(tanks.map((t) => t.productType))),
    [tanks],
  );

  function loadNozzles() {
    return getNozzles()
      .then((result) => {
        setNozzles(result);
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
    getNozzles()
      .then((result) => {
        if (!cancelled) setNozzles(result);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
    getTanks()
      .then((result) => {
        if (!cancelled) setTanks(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      await createNozzle({
        label: label.trim(),
        productType: productType.trim(),
        startingReading: Number(startingReading),
      });
      setLabel('');
      setProductType('');
      setStartingReading('');
      await loadNozzles();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(nozzle: Nozzle) {
    setEditingId(nozzle.id);
    setEditLabel(nozzle.label);
    setEditProductType(nozzle.productType);
    setEditStartingReading(String(nozzle.startingReading));
    setEditError(null);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      // Backend rejects (409) the startingReading portion of this if the
      // nozzle already has shift history — surfaced as-is, not re-checked
      // client-side (see UpdateNozzleRequest's comment).
      await updateNozzle(editingId, {
        label: editLabel.trim(),
        productType: editProductType.trim(),
        startingReading: Number(editStartingReading),
      });
      setEditingId(null);
      await loadNozzles();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleActive(nozzle: Nozzle) {
    try {
      await updateNozzle(nozzle.id, { isActive: !nozzle.isActive });
      await loadNozzles();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        <h3>Nozzle / meter configuration</h3>
        <span className="section-note">
          Section 3.3/4 — add exactly as many nozzles/meters as this pump physically has. Each nozzle&rsquo;s
          starting reading is a ONE-TIME baseline: every shift after its first carries the previous
          shift&rsquo;s closing reading forward automatically — neither a DSM nor this form can edit that
          carried-forward opening reading directly.
        </span>
      </div>

      {loadError && <div className="error-box">{loadError}</div>}
      {!loadError && !nozzles && <div className="loading">Loading nozzles&hellip;</div>}

      {!loadError && nozzles && (
        nozzles.length === 0 ? (
          <div className="empty-box">No nozzles configured yet — add this pump&rsquo;s first nozzle below.</div>
        ) : (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Product</th>
                  <th className="num">Starting reading</th>
                  <th className="num">Next opening reading</th>
                  <th>Status</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {nozzles.map((nozzle) =>
                  editingId === nozzle.id ? (
                    <tr key={nozzle.id}>
                      <td colSpan={canManage ? 6 : 5}>
                        <form
                          onSubmit={(e) => {
                            void handleSaveEdit(e);
                          }}
                          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Label"
                            required
                            style={{ width: 90 }}
                          />
                          <input
                            list="nozzle-product-types"
                            value={editProductType}
                            onChange={(e) => setEditProductType(e.target.value)}
                            placeholder="Product"
                            required
                            style={{ width: 120 }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editStartingReading}
                            onChange={(e) => setEditStartingReading(e.target.value)}
                            placeholder="Starting reading"
                            required
                            style={{ width: 140 }}
                            title="Only takes effect if this nozzle has no shift history yet — the backend rejects the change otherwise."
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
                    <tr key={nozzle.id}>
                      <td style={{ fontWeight: 700 }}>{nozzle.label}</td>
                      <td>{nozzle.productType}</td>
                      <td className="num">{nozzle.startingReading.toFixed(1)}</td>
                      <td className="num">{nozzle.nextOpeningReading.toFixed(1)}</td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background: nozzle.isActive ? 'var(--green-bg)' : 'var(--page-bg)',
                            color: nozzle.isActive ? 'var(--green)' : 'var(--gray)',
                          }}
                        >
                          {nozzle.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="chevron">
                          <button type="button" className="icon-btn" onClick={() => startEdit(nozzle)}>
                            Edit
                          </button>{' '}
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => {
                              void handleToggleActive(nozzle);
                            }}
                          >
                            {nozzle.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <div className="footnote">
              &ldquo;Next opening reading&rdquo; is what this nozzle&rsquo;s NEXT shift will open with — the
              previous shift&rsquo;s closing reading, carried forward automatically. Disabling a nozzle hides
              it from new shift-start pickers without deleting its reading history.
            </div>
          </div>
        )
      )}

      <datalist id="nozzle-product-types">
        {knownProductTypes.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {canManage ? (
        <form
          onSubmit={(e) => {
            void handleAdd(e);
          }}
          style={{ marginTop: 16 }}
        >
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="nz-label">Label</label>
              <input
                id="nz-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. N1"
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="nz-product">Product type</label>
              <input
                id="nz-product"
                list="nozzle-product-types"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                placeholder="e.g. Petrol"
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="nz-starting">Starting reading</label>
              <input
                id="nz-starting"
                type="number"
                min="0"
                step="0.01"
                value={startingReading}
                onChange={(e) => setStartingReading(e.target.value)}
                required
              />
            </div>
          </div>
          {addError && <div className="form-error">{addError}</div>}
          <div className="modal-actions">
            <button type="submit" className="export-btn" disabled={adding}>
              {adding ? 'Adding…' : '+ Add nozzle'}
            </button>
          </div>
        </form>
      ) : (
        <div className="section-note">
          Only the Owner/Accountant can add or edit nozzles — this view is read-only for your role.
        </div>
      )}
    </div>
  );
}
