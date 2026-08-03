import { useEffect, useState, type FormEvent } from 'react';
import { createTank, deleteTank, getTanks, updateTank } from '../../api/tanks';
import { ApiError } from '../../api/client';
import type { Tank } from '../../api/types';

interface TankSettingsProps {
  canManage: boolean;
}

// Section 7.1 — Tank Master (Settings): "how many physical tanks does this
// pump have." Same add/delete pattern as Nozzle Master (see
// NozzleSettings.tsx) — a plain dealer-managed list, since different pumps
// have a different number of underground tanks. Every tank picker elsewhere
// in this app (Nozzle Settings' tank link dropdown, Generator Diesel,
// Machine Testing, DIP readings) reads GET /tanks and renders a dropdown
// over these rows.
//
// Unlike Nozzle (soft-disable only, no delete), Tank supports a real DELETE
// — TanksService.remove() blocks it (409, surfaced as-is below) while the
// tank still holds stock, has a nozzle linked to it, or has any recorded
// DIP/density/generator/testing history.
//
// canManage gates create/edit/delete to Owner/Accountant (mirrors the
// backend's @Roles(Role.OWNER, Role.ACCOUNTANT) on TanksController).
export function TankSettings({ canManage }: TankSettingsProps) {
  const [tanks, setTanks] = useState<Tank[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tankNumber, setTankNumber] = useState('');
  const [productType, setProductType] = useState('');
  const [capacityLitres, setCapacityLitres] = useState('');
  const [currentStockLitres, setCurrentStockLitres] = useState('');
  const [calibrationChartRef, setCalibrationChartRef] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTankNumber, setEditTankNumber] = useState('');
  const [editProductType, setEditProductType] = useState('');
  const [editCapacityLitres, setEditCapacityLitres] = useState('');
  const [editCurrentStockLitres, setEditCurrentStockLitres] = useState('');
  const [editCalibrationChartRef, setEditCalibrationChartRef] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function loadTanks() {
    return getTanks()
      .then((result) => {
        setTanks(result);
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
    getTanks()
      .then((result) => {
        if (!cancelled) setTanks(result);
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
      await createTank({
        tankNumber: tankNumber.trim(),
        productType: productType.trim(),
        capacityLitres: Number(capacityLitres),
        ...(currentStockLitres.trim() && { currentStockLitres: Number(currentStockLitres) }),
        ...(calibrationChartRef.trim() && { calibrationChartRef: calibrationChartRef.trim() }),
      });
      setTankNumber('');
      setProductType('');
      setCapacityLitres('');
      setCurrentStockLitres('');
      setCalibrationChartRef('');
      await loadTanks();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(tank: Tank) {
    setEditingId(tank.id);
    setEditTankNumber(tank.tankNumber);
    setEditProductType(tank.productType);
    setEditCapacityLitres(String(tank.capacityLitres));
    setEditCurrentStockLitres(String(tank.currentStockLitres));
    setEditCalibrationChartRef(tank.calibrationChartRef ?? '');
    setEditError(null);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      await updateTank(editingId, {
        tankNumber: editTankNumber.trim(),
        productType: editProductType.trim(),
        capacityLitres: Number(editCapacityLitres),
        currentStockLitres: Number(editCurrentStockLitres),
        calibrationChartRef: editCalibrationChartRef.trim() || undefined,
      });
      setEditingId(null);
      await loadTanks();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(tank: Tank) {
    if (!window.confirm(`Delete tank ${tank.tankNumber} (${tank.productType})? This can't be undone.`)) return;
    setDeleteError(null);
    setDeletingId(tank.id);
    try {
      // Backend rejects (409) while this tank still holds stock, has a
      // linked nozzle, or has recorded history — surfaced as-is.
      await deleteTank(tank.id);
      await loadTanks();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="section" id="tank-master">
      <div className="section-title">
        <h3>Tank Master</h3>
        <span className="section-note">
          Section 7.1 — add exactly as many tanks as this pump physically has. A tank can only be
          deleted while it holds zero stock, has no nozzle linked to it, and has no recorded DIP/
          density/generator/testing history.
        </span>
      </div>

      {loadError && <div className="error-box">{loadError}</div>}
      {!loadError && !tanks && <div className="loading">Loading tanks&hellip;</div>}

      {!loadError && tanks && (
        tanks.length === 0 ? (
          <div className="empty-box">No tanks configured yet — add this pump&rsquo;s first tank below.</div>
        ) : (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tank #</th>
                  <th>Product</th>
                  <th className="num">Capacity (L)</th>
                  <th className="num">Current stock (L)</th>
                  <th>Calibration chart ref</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {tanks.map((tank) =>
                  editingId === tank.id ? (
                    <tr key={tank.id}>
                      <td colSpan={canManage ? 6 : 5}>
                        <form
                          onSubmit={(e) => {
                            void handleSaveEdit(e);
                          }}
                          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <input
                            value={editTankNumber}
                            onChange={(e) => setEditTankNumber(e.target.value)}
                            placeholder="Tank # (e.g. 1)"
                            required
                            style={{ width: 100 }}
                          />
                          <input
                            value={editProductType}
                            onChange={(e) => setEditProductType(e.target.value)}
                            placeholder="Product (e.g. Petrol)"
                            required
                            style={{ width: 120 }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={editCapacityLitres}
                            onChange={(e) => setEditCapacityLitres(e.target.value)}
                            placeholder="Capacity (L)"
                            required
                            style={{ width: 130 }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editCurrentStockLitres}
                            onChange={(e) => setEditCurrentStockLitres(e.target.value)}
                            placeholder="Current stock (L)"
                            required
                            style={{ width: 150 }}
                            title="Manual correction only — day-to-day this should move via Purchase Entry and meter reading closes, not this field."
                          />
                          <input
                            value={editCalibrationChartRef}
                            onChange={(e) => setEditCalibrationChartRef(e.target.value)}
                            placeholder="Calibration chart ref (optional)"
                            style={{ width: 180 }}
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
                    <tr key={tank.id}>
                      <td style={{ fontWeight: 700 }}>{tank.tankNumber}</td>
                      <td>{tank.productType}</td>
                      <td className="num">{tank.capacityLitres.toLocaleString()}</td>
                      <td className="num">{tank.currentStockLitres.toLocaleString()}</td>
                      <td>{tank.calibrationChartRef ?? '—'}</td>
                      {canManage && (
                        <td className="chevron">
                          <button type="button" className="icon-btn" onClick={() => startEdit(tank)}>
                            Edit
                          </button>{' '}
                          <button
                            type="button"
                            className="icon-btn"
                            disabled={deletingId === tank.id}
                            onClick={() => {
                              void handleDelete(tank);
                            }}
                          >
                            {deletingId === tank.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {deleteError && <div className="form-error">{deleteError}</div>}
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
              <label htmlFor="tk-number">Tank #</label>
              <input
                id="tk-number"
                value={tankNumber}
                onChange={(e) => setTankNumber(e.target.value)}
                placeholder="e.g. 1"
                required
                title="Physical tank number — must be unique for this pump. Used to link this tank to a nozzle in Nozzle Master."
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="tk-product">Product</label>
              <input
                id="tk-product"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                placeholder="e.g. Petrol"
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="tk-capacity">Capacity (litres)</label>
              <input
                id="tk-capacity"
                type="number"
                min="0"
                step="1"
                value={capacityLitres}
                onChange={(e) => setCapacityLitres(e.target.value)}
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="tk-stock">Current stock (litres, optional)</label>
              <input
                id="tk-stock"
                type="number"
                min="0"
                step="0.01"
                value={currentStockLitres}
                onChange={(e) => setCurrentStockLitres(e.target.value)}
                placeholder="Defaults to 0"
                title="Starting stock at the moment this tank is registered — leave blank for a brand-new tank (defaults to 0)."
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="tk-chart">Calibration chart ref (optional)</label>
              <input
                id="tk-chart"
                value={calibrationChartRef}
                onChange={(e) => setCalibrationChartRef(e.target.value)}
                placeholder="e.g. filed reference no."
              />
            </div>
          </div>
          {addError && <div className="form-error">{addError}</div>}
          <div className="modal-actions">
            <button type="submit" className="export-btn" disabled={adding}>
              {adding ? 'Adding…' : '+ Add tank'}
            </button>
          </div>
        </form>
      ) : (
        <div className="section-note">
          Only the Owner/Accountant can add, edit, or delete tanks — this view is read-only for your role.
        </div>
      )}
    </div>
  );
}
