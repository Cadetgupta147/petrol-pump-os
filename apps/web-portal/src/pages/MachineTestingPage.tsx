import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { createMachineTestingLog, getMachineTestingLogs } from '../api/machineTesting';
import { getTanks } from '../api/tanks';
import { ApiError } from '../api/client';
import { formatLitres, formatDateTime } from '../utils/format';
import type { CreateMachineTestingLogRequest, MachineTestingLog, Tank } from '../api/types';

// Dashboard "Not wired to a backend endpoint yet" panel item #5 — "Machine
// testing/calibration". Owner/Accountant/Manager server-side
// (MachineTestingController). Deliberately independent of Meter Readings —
// see the schema comment on MachineTestingLog for why this doesn't touch
// the deferred MeterReading "Testing" formula change.
export function MachineTestingPage() {
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [logs, setLogs] = useState<MachineTestingLog[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [tankId, setTankId] = useState('');
  const [litresDrawnOff, setLitresDrawnOff] = useState('');
  const [result, setResult] = useState('');
  const [deviationFound, setDeviationFound] = useState('');
  const [calibrationChartRef, setCalibrationChartRef] = useState('');
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
    getMachineTestingLogs()
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
    setLitresDrawnOff('');
    setResult('');
    setDeviationFound('');
    setCalibrationChartRef('');
    setNotes('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      const dto: CreateMachineTestingLogRequest = {
        tankId,
        result: result.trim(),
        litresDrawnOff: litresDrawnOff.trim() === '' ? undefined : Number(litresDrawnOff.trim()),
        deviationFound: deviationFound.trim() === '' ? undefined : Number(deviationFound.trim()),
        calibrationChartRef: calibrationChartRef.trim() === '' ? undefined : calibrationChartRef.trim(),
        notes: notes.trim() === '' ? undefined : notes.trim(),
      };
      const created = await createMachineTestingLog(dto);
      setLogs((prev) => (prev ? [created, ...prev] : [created]));
      resetForm();
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
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
          <h3>New machine test / calibration entry</h3>
          <span className="section-note">
            POST /machine-testing-logs — only decrements tank stock if litres are drawn off
          </span>
        </div>

        <div className="section">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="grid grid-2">
              <div className="form-field">
                <label htmlFor="mt-tank">Tank</label>
                <select
                  id="mt-tank"
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
                <label htmlFor="mt-result">Result</label>
                <input
                  id="mt-result"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  placeholder="e.g. Pass, Fail, Within tolerance"
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="mt-litres">Litres drawn off</label>
                <input
                  id="mt-litres"
                  type="number"
                  min="0"
                  step="any"
                  value={litresDrawnOff}
                  onChange={(e) => setLitresDrawnOff(e.target.value)}
                  placeholder="Optional — defaults to 0"
                />
              </div>
              <div className="form-field">
                <label htmlFor="mt-deviation">Deviation found</label>
                <input
                  id="mt-deviation"
                  type="number"
                  step="any"
                  value={deviationFound}
                  onChange={(e) => setDeviationFound(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="form-field">
                <label htmlFor="mt-chart-ref">Calibration chart ref</label>
                <input
                  id="mt-chart-ref"
                  value={calibrationChartRef}
                  onChange={(e) => setCalibrationChartRef(e.target.value)}
                  placeholder="Optional — link or filename"
                />
              </div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="mt-notes">Notes</label>
                <input
                  id="mt-notes"
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
            <h3>Machine testing log</h3>
            <span className="section-note">GET /machine-testing-logs — most recent first</span>
          </div>
          {logsError && <div className="error-box">{logsError}</div>}
          {!logsError && !logs && <div className="loading">Loading log…</div>}
          {!logsError && logs && logs.length === 0 && (
            <div className="empty-box">No machine tests recorded yet.</div>
          )}
          {!logsError && logs && logs.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tank</th>
                    <th>Result</th>
                    <th className="num">Litres drawn off</th>
                    <th className="num">Deviation</th>
                    <th>Chart ref</th>
                    <th>Performed at</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{tankLabel(log.tankId)}</td>
                      <td>{log.result}</td>
                      <td className="num">{formatLitres(log.litresDrawnOff)}</td>
                      <td className="num">{log.deviationFound ?? '—'}</td>
                      <td>{log.calibrationChartRef ?? '—'}</td>
                      <td>{formatDateTime(log.performedAt)}</td>
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
