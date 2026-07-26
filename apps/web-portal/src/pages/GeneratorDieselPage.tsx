import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { createGeneratorDieselLog, getGeneratorDieselLogs } from '../api/generatorDiesel';
import { getTanks } from '../api/tanks';
import { ApiError } from '../api/client';
import { formatLitres, formatDateTime } from '../utils/format';
import type { CreateGeneratorDieselLogRequest, GeneratorDieselLog, Tank } from '../api/types';

// Dashboard "Not wired to a backend endpoint yet" panel item #3 —
// "Generator diesel used". Owner/Accountant/Manager server-side
// (GeneratorDieselController) — a DSM/Read-only hitting this page just sees
// the backend's 403 in the error-box below, same pattern as every other
// log-entry page in this app.
export function GeneratorDieselPage() {
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [logs, setLogs] = useState<GeneratorDieselLog[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [tankId, setTankId] = useState('');
  const [quantityLitres, setQuantityLitres] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTanks()
      .then((result) => {
        if (!cancelled) {
          setTanks(result);
          setTankId((prev) => prev || (result[0]?.id ?? ''));
        }
      })
      .catch(() => undefined);
    getGeneratorDieselLogs()
      .then((result) => {
        if (!cancelled) setLogs(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setLogsError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setQuantityLitres('');
    setNotes('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      const dto: CreateGeneratorDieselLogRequest = {
        tankId,
        quantityLitres: Number(quantityLitres.trim()),
        notes: notes.trim() === '' ? undefined : notes.trim(),
      };
      const created = await createGeneratorDieselLog(dto);
      setLogs((prev) => (prev ? [created, ...prev] : [created]));
      resetForm();
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      // Covers the 404 "Tank X not found" hard-block directly
      // (GeneratorDieselService.create()) — surfaced verbatim.
      setSaveError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSaving(false);
    }
  }

  function tankLabel(id: string): string {
    return tanks.find((t) => t.id === id)?.productType ?? id;
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>New generator diesel entry</h3>
          <span className="section-note">POST /generator-diesel-logs — decrements the selected tank</span>
        </div>

        <div className="section">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="grid grid-2">
              <div className="form-field">
                <label htmlFor="gd-tank">Tank</label>
                <select
                  id="gd-tank"
                  value={tankId}
                  onChange={(e) => setTankId(e.target.value)}
                  required
                >
                  {tanks.length === 0 && <option value="">No tanks configured</option>}
                  {tanks.map((tank) => (
                    <option key={tank.id} value={tank.id}>
                      {tank.productType} — {formatLitres(tank.currentStockLitres)} in stock
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="gd-quantity">Quantity (litres)</label>
                <input
                  id="gd-quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={quantityLitres}
                  onChange={(e) => setQuantityLitres(e.target.value)}
                  required
                />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="gd-notes">Notes</label>
                <input
                  id="gd-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {saveError && <div className="form-error">{saveError}</div>}
            {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={resetForm} disabled={saving}>
                Clear form
              </button>
              <button type="submit" className="export-btn" disabled={saving || !tankId}>
                {saving ? 'Saving…' : 'Save entry'}
              </button>
            </div>
          </form>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Generator diesel log</h3>
            <span className="section-note">GET /generator-diesel-logs — most recent first</span>
          </div>
          {logsError && <div className="error-box">{logsError}</div>}
          {!logsError && !logs && <div className="loading">Loading log…</div>}
          {!logsError && logs && logs.length === 0 && (
            <div className="empty-box">No generator diesel usage recorded yet.</div>
          )}
          {!logsError && logs && logs.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tank</th>
                    <th className="num">Quantity</th>
                    <th>Notes</th>
                    <th>Recorded at</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{tankLabel(log.tankId)}</td>
                      <td className="num">{formatLitres(log.quantityLitres)}</td>
                      <td>{log.notes ?? '—'}</td>
                      <td>{formatDateTime(log.recordedAt)}</td>
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
