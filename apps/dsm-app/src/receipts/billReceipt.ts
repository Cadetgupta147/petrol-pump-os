import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Bill, BillPaymentLine } from '../api/billsApi';

const RECEIPTS_DIR_NAME = 'receipts';

// Pump identity fields aren't wired up to a Settings/business-profile source
// yet (Section 3.9) — placeholder header text only, not a real config read.
const PUMP_NAME_PLACEHOLDER = 'Petrol Pump';

export class ReceiptError extends Error {}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return escapeHtml(timestamp);
  return escapeHtml(
    date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  );
}

function paymentLineRow(line: BillPaymentLine, isSplit: boolean): string {
  const label = line.direction === 'OUT' ? `${line.paymentType} (change given)` : line.paymentType;
  const sign = line.direction === 'OUT' ? '−' : '';
  const note = isSplit && line.direction === 'IN' ? ' (collected)' : '';
  return `
    <tr>
      <td>${escapeHtml(label)}${note}</td>
      <td class="amount">${sign}₹${line.amount.toFixed(2)}</td>
    </tr>`;
}

// HTML-only receipt template for expo-print's printToFileAsync. Bluetooth
// ESC/POS printing (Section 4, Section 15.8) is explicitly deferred — this is
// file generation only, no printer pairing.
export function buildReceiptHtml(bill: Bill): string {
  const isSplit = bill.paymentLines.length > 1;

  const identityRows: string[] = [];
  if (bill.vehicleNumber) {
    identityRows.push(`<tr><td>Vehicle Number</td><td>${escapeHtml(bill.vehicleNumber)}</td></tr>`);
  }
  if (bill.customerName) {
    identityRows.push(`<tr><td>Customer Name</td><td>${escapeHtml(bill.customerName)}</td></tr>`);
  }

  const paymentRows = bill.paymentLines.map((line) => paymentLineRow(line, isSplit)).join('');

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #222; padding: 24px; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      td { padding: 6px 4px; border-bottom: 1px solid #eee; font-size: 14px; }
      td.amount { text-align: right; }
      .section-title { font-weight: 700; margin-top: 20px; margin-bottom: 6px; font-size: 13px; text-transform: uppercase; color: #444; }
      .total-row td { font-weight: 700; border-top: 2px solid #222; border-bottom: none; }
      .footer { margin-top: 28px; font-size: 11px; color: #999; text-align: center; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(PUMP_NAME_PLACEHOLDER)}</h1>
    <div class="subtitle">Receipt #${escapeHtml(bill.id)} &middot; ${formatTimestamp(bill.timestamp)}</div>

    <table>
      ${identityRows.join('')}
      <tr><td>Product</td><td>${escapeHtml(bill.productType)}</td></tr>
      <tr><td>Litres</td><td>${bill.litres}</td></tr>
      <tr><td>Rate Applied</td><td>₹${bill.rateApplied.toFixed(2)} / litre</td></tr>
      <tr class="total-row"><td>Bill Amount</td><td class="amount">₹${bill.amount.toFixed(2)}</td></tr>
    </table>

    <div class="section-title">${isSplit ? 'Payment Breakdown (Split Payment)' : 'Payment'}</div>
    <table>
      ${paymentRows}
    </table>

    <div class="footer">This is a system-generated receipt.</div>
  </body>
</html>`;
}

function safeFileNameFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export interface SavedReceipt {
  uri: string;
  fileName: string;
}

// Copies expo-print's transient cache output into the app's persistent
// document directory so the PDF survives beyond the current session — a
// cache-only file can be reclaimed by the OS at any time.
export async function generateAndSaveReceiptPdf(bill: Bill): Promise<SavedReceipt> {
  let printedUri: string;
  try {
    const result = await Print.printToFileAsync({ html: buildReceiptHtml(bill) });
    printedUri = result.uri;
  } catch {
    throw new ReceiptError('Could not generate the receipt PDF.');
  }

  try {
    const receiptsDir = new Directory(Paths.document, RECEIPTS_DIR_NAME);
    if (!receiptsDir.exists) {
      receiptsDir.create({ intermediates: true });
    }

    const fileName = `receipt-${safeFileNameFragment(bill.id)}-${Date.now()}.pdf`;
    const destination = new File(receiptsDir, fileName);
    const tempFile = new File(printedUri);
    await tempFile.copy(destination, { overwrite: true });

    return { uri: destination.uri, fileName };
  } catch {
    throw new ReceiptError('Could not save the receipt to device storage.');
  }
}

export async function shareReceiptPdf(uri: string): Promise<void> {
  let available: boolean;
  try {
    available = await Sharing.isAvailableAsync();
  } catch {
    available = false;
  }
  if (!available) {
    throw new ReceiptError('Sharing is not available on this device.');
  }
  try {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Receipt' });
  } catch {
    throw new ReceiptError('Could not open the share sheet.');
  }
}
