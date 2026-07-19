import { useEffect, useState } from 'react';
import { getCustomerQrCard } from '../../api/customers';
import { ApiError } from '../../api/client';
import type { CustomerQrCard } from '../../api/types';

interface QrCardModalProps {
  customerId: string;
  onClose: () => void;
}

// Section 6.1/6.7 — the customer's QR card. The QR encodes ONLY the member
// id (server-side rule, pinned by a backend test) — the name/vehicle shown
// under it are the printed card's human-readable caption, not QR content,
// so a rate or balance change never requires reprinting the card.
export function QrCardModal({ customerId, onClose }: QrCardModalProps) {
  const [card, setCard] = useState<CustomerQrCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCustomerQrCard(customerId)
      .then((result) => {
        if (!cancelled) setCard(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Opens a minimal print window containing just the card (SVG for crisp
  // print — Section 6.7 recommends laminated PVC, so resolution matters).
  function handlePrint() {
    if (!card) return;
    const win = window.open('', '_blank', 'width=420,height=560');
    if (!win) return;
    win.document.write(`<!doctype html>
<html>
  <head><title>QR card — ${card.name}</title></head>
  <body style="font-family: sans-serif; text-align: center; margin: 24px;">
    <div style="width: 300px; margin: 0 auto;">${card.svg}</div>
    <h2 style="margin: 8px 0 4px;">${card.name}</h2>
    <div>${card.vehicleNumber ?? ''}</div>
    <div style="font-size: 12px; color: #666; margin-top: 8px;">Member ID: ${card.qrMemberId}</div>
  </body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <h3>QR card</h3>
          <span className="section-note">encodes only the member ID — no name, points, or rate</span>
        </div>

        {error && <div className="form-error">{error}</div>}
        {!error && !card && <div className="loading">Generating QR card…</div>}

        {card && (
          <div style={{ textAlign: 'center' }}>
            <img
              src={card.pngDataUrl}
              alt={`QR card for ${card.name}`}
              style={{ width: 240, height: 240 }}
            />
            <div style={{ fontWeight: 600 }}>{card.name}</div>
            {card.vehicleNumber && <div>{card.vehicleNumber}</div>}
            <div className="section-note" style={{ marginTop: 8 }}>
              Member ID: {card.qrMemberId}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="export-btn" onClick={handlePrint} disabled={!card}>
            Print card
          </button>
        </div>
      </div>
    </div>
  );
}
