import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getPurchaseEntries, createPurchaseEntry, ocrExtractInvoice } from '../api/purchases';
import { ApiError } from '../api/client';
import { formatLitres, formatRupees, formatRatePerLitre, formatDateTime } from '../utils/format';
import type { CreatePurchaseEntryRequest, PurchaseEntry } from '../api/types';

// Section 7.1/7.2 (manual purchase entry -> tank stock increment) + Section
// 9 (OCR pre-fill). Owner/Accountant only server-side
// (@Roles(Role.OWNER, Role.ACCOUNTANT), class-level on PurchasesController,
// covering both POST /purchase-entries and POST
// /purchase-entries/ocr-extract) — a DSM hitting this page just sees the
// backend's 403 in the error-box below on load, same as every other page.
//
// Judgment calls (flagged per the task instructions, not hidden):
//  - No density/PPM fields on this form. Section 7.3's DensityLog is a
//    separate row linked via purchaseEntryId, and CreatePurchaseEntryDto's
//    densityValue/ppmValue/recordedById trio requires recordedById whenever
//    densityValue is present (PurchasesService.create()'s cross-field
//    check) — wiring that in cleanly wants a recordedById selector (a
//    logged-in staff picker) this task didn't ask for. Left out; the
//    backend already accepts a simpler purchase entry without them.
//  - invoiceImageUrl is never sent from this form. There's no file-storage
//    backend wired up yet (OcrService's controller comment: the uploaded
//    image lives only for the duration of the OCR request, memoryStorage
//    only, nothing persists it) — sending a client-side blob: URL as
//    "invoiceImageUrl" would be a broken reference the moment the tab
//    closes, so the field is just omitted rather than faked.
//  - ocrExtracted is provenance for the WHOLE entry ("did this entry
//    originate from an OCR-assisted flow"), not a per-field freshness flag.
//    It's set true as soon as a successful OCR extraction pre-fills the
//    form and stays true even as the human edits/corrects individual
//    fields afterward (exactly the review step Section 9 requires) — it
//    only resets to false when the form itself is cleared/reset.
export function PurchaseEntryPage() {
  const [entries, setEntries] = useState<PurchaseEntry[] | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const [supplierName, setSupplierName] = useState('');
  const [productType, setProductType] = useState('');
  const [quantityLitres, setQuantityLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [ratePerLitre, setRatePerLitre] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [tankerNo, setTankerNo] = useState('');
  const [ocrExtracted, setOcrExtracted] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrRawText, setOcrRawText] = useState<string | null>(null);
  const [ocrInvoiceDate, setOcrInvoiceDate] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPurchaseEntries()
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setEntriesError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setSupplierName('');
    setProductType('');
    setQuantityLitres('');
    setAmount('');
    setRatePerLitre('');
    setInvoiceNo('');
    setTankerNo('');
    setOcrExtracted(false);
    setOcrRawText(null);
    setOcrInvoiceDate(null);
    setOcrError(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Step 2/3 of Section 9's flow: call ocr-extract, then pre-fill the same
  // form fields below with whatever came back. Nulls are left blank (''),
  // never coerced to "0" — a null quantityLitres must not look like a real
  // zero-litre delivery. This function ends here; it never calls
  // createPurchaseEntry itself (see the file-level comment above and
  // handleSubmit below for the only path that does).
  async function handleOcrExtract() {
    if (!file) return;
    setOcrError(null);
    setOcrLoading(true);
    try {
      const result = await ocrExtractInvoice(file);
      const f = result.extractedFields;
      setSupplierName(f.supplierName ?? '');
      setProductType(f.productType ?? '');
      setQuantityLitres(f.quantityLitres !== null ? String(f.quantityLitres) : '');
      setAmount(f.amount !== null ? String(f.amount) : '');
      setRatePerLitre(f.ratePerLitre !== null ? String(f.ratePerLitre) : '');
      setInvoiceNo(f.invoiceNo ?? '');
      setTankerNo(f.tankerNo ?? '');
      setOcrInvoiceDate(f.invoiceDate);
      setOcrRawText(result.rawText);
      setOcrExtracted(true);
    } catch (err) {
      // Covers the 409 "Google Cloud Vision not configured" case directly —
      // a real dealer-config gap, not a bug, so the backend's message is
      // shown as-is rather than a generic "extraction failed".
      setOcrError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setOcrLoading(false);
    }
  }

  // Step 5 of Section 9's flow (and the only save path for a fully manual
  // entry too): an explicit submit is the sole trigger for
  // POST /purchase-entries. Whatever is in the form fields right now —
  // whether OCR-prefilled-then-edited or typed from scratch — is what gets
  // sent; nothing here re-reads the OCR response.
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      const dto: CreatePurchaseEntryRequest = {
        supplierName: supplierName.trim(),
        productType: productType.trim(),
        quantityLitres: Number(quantityLitres.trim()),
        amount: Number(amount.trim()),
        ratePerLitre: Number(ratePerLitre.trim()),
        invoiceNo: invoiceNo.trim() === '' ? undefined : invoiceNo.trim(),
        tankerNo: tankerNo.trim() === '' ? undefined : tankerNo.trim(),
        ocrExtracted,
      };
      const created = await createPurchaseEntry(dto);
      setEntries((prev) => (prev ? [created, ...prev] : [created]));
      resetForm();
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      // Covers the 404 "no Tank configured for product X" hard-block
      // directly (PurchasesService.create()) — surfaced verbatim rather
      // than hidden behind a generic save-failed message.
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
          <h3>New purchase entry</h3>
          <span className="section-note">POST /purchase-entries — Section 7.1/7.2</span>
        </div>

        <div className="section">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-label">UPLOAD INVOICE (OCR) — SECTION 9</div>
            <div className="card-sub" style={{ marginBottom: 10 }}>
              Best-effort pre-fill for the form below, from a photo of the invoice. Nothing is saved
              by this step — every field must still be reviewed (and corrected if needed) before you
              press &ldquo;Save purchase entry&rdquo;.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void handleOcrExtract();
                }}
                disabled={!file || ocrLoading}
              >
                {ocrLoading ? 'Extracting…' : 'Extract from invoice'}
              </button>
              {ocrExtracted && (
                <span className="badge" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
                  Form pre-filled from OCR — review before saving
                </span>
              )}
            </div>
            {ocrError && <div className="form-error" style={{ marginTop: 10 }}>{ocrError}</div>}
            {ocrInvoiceDate && (
              <div className="footnote">
                Invoice date detected: {ocrInvoiceDate} — informational only, PurchaseEntry has no
                date field to store this in.
              </div>
            )}
            {ocrRawText && (
              <details style={{ marginTop: 10 }}>
                <summary className="section-note" style={{ cursor: 'pointer' }}>
                  Raw OCR text (for verification)
                </summary>
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 8 }}>{ocrRawText}</pre>
              </details>
            )}
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="grid grid-2">
              <div className="form-field">
                <label htmlFor="pe-supplier">Supplier name</label>
                <input
                  id="pe-supplier"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="pe-product">Product type</label>
                <input
                  id="pe-product"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="e.g. Petrol, Diesel"
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="pe-quantity">Quantity (litres)</label>
                <input
                  id="pe-quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={quantityLitres}
                  onChange={(e) => setQuantityLitres(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="pe-rate">Rate per litre (Rs.)</label>
                <input
                  id="pe-rate"
                  type="number"
                  min="0"
                  step="any"
                  value={ratePerLitre}
                  onChange={(e) => setRatePerLitre(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="pe-amount">Total invoice amount (Rs.)</label>
                <input
                  id="pe-amount"
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="pe-invoice-no">Invoice no.</label>
                <input
                  id="pe-invoice-no"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="form-field">
                <label htmlFor="pe-tanker-no">Tanker no.</label>
                <input
                  id="pe-tanker-no"
                  value={tankerNo}
                  onChange={(e) => setTankerNo(e.target.value)}
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
              <button type="submit" className="export-btn" disabled={saving}>
                {saving ? 'Saving…' : 'Save purchase entry'}
              </button>
            </div>
          </form>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Purchase entries</h3>
            <span className="section-note">GET /purchase-entries — most recent first</span>
          </div>
          {entriesError && <div className="error-box">{entriesError}</div>}
          {!entriesError && !entries && <div className="loading">Loading purchase entries…</div>}
          {!entriesError && entries && entries.length === 0 && (
            <div className="empty-box">No purchase entries recorded yet.</div>
          )}
          {!entriesError && entries && entries.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Product</th>
                    <th className="num">Quantity</th>
                    <th className="num">Rate</th>
                    <th className="num">Amount</th>
                    <th>Invoice no.</th>
                    <th>Tanker no.</th>
                    <th>Source</th>
                    <th>Recorded at</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.supplierName}</td>
                      <td>{entry.productType}</td>
                      <td className="num">{formatLitres(entry.quantityLitres)}</td>
                      <td className="num">{formatRatePerLitre(entry.ratePerLitre)}</td>
                      <td className="num">{formatRupees(entry.amount)}</td>
                      <td>{entry.invoiceNo ?? '—'}</td>
                      <td>{entry.tankerNo ?? '—'}</td>
                      <td>
                        {entry.ocrExtracted ? (
                          <span
                            className="badge"
                            style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
                          >
                            OCR-assisted
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{ background: 'var(--page-bg)', color: 'var(--gray)' }}
                          >
                            Manual
                          </span>
                        )}
                      </td>
                      <td>{formatDateTime(entry.createdAt)}</td>
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
