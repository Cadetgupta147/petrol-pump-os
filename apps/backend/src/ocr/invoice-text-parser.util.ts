// Section 9 — pure, independently-testable parsing of Google Cloud Vision's
// DOCUMENT_TEXT_DETECTION output into Purchase Entry pre-fill fields.
//
// This is deliberately best-effort: printed supplier/tanker invoices vary a
// lot across OMCs and distributors, and thermal-printed challans fade. The
// design goal per Section 9 is "reasonable effort, human confirms/corrects
// before save" — NOT perfect extraction. Every field is nullable; we never
// force a guess when a regex doesn't find a confident match.
export interface ExtractedInvoiceFields {
  supplierName: string | null;
  productType: string | null;
  quantityLitres: number | null;
  ratePerLitre: number | null;
  amount: number | null;
  invoiceNo: string | null;
  tankerNo: string | null;
  // Informational only — there's no `date` field on PurchaseEntry
  // (createdAt is server-set), so this is for the human to eyeball, not
  // mapped to any create-DTO field.
  invoiceDate: string | null;
}

const KNOWN_SUPPLIERS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /indian\s*oil(?:\s*corporation)?|iocl/i, name: 'IOCL (Indian Oil Corporation)' },
  { pattern: /bharat\s*petroleum|bpcl/i, name: 'BPCL (Bharat Petroleum)' },
  { pattern: /hindustan\s*petroleum|hpcl/i, name: 'HPCL (Hindustan Petroleum)' },
];

// Indian vehicle registration plate, e.g. "MH12AB1234", "MH 12 AB 1234",
// "MH-12-AB-1234". Loose on separators since OCR spacing is unreliable.
const VEHICLE_PLATE_REGEX =
  /\b([A-Za-z]{2})[\s-]?(\d{1,2})[\s-]?([A-Za-z]{1,3})[\s-]?(\d{4})\b/;

// Bare number, optionally with thousands separators/decimal.
const NUMBER_TOKEN = '[\\d,]+(?:\\.\\d+)?';

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function firstMatch(text: string, regex: RegExp): RegExpMatchArray | null {
  return text.match(regex);
}

function extractSupplierName(text: string): string | null {
  for (const { pattern, name } of KNOWN_SUPPLIERS) {
    if (pattern.test(text)) {
      return name;
    }
  }

  // Fallback: look near a "Supplier"/"From" label on its own line, e.g.
  // "Supplier: XYZ Fuels Pvt Ltd" or "From : ABC Distributors".
  const labelMatch = firstMatch(
    text,
    /(?:supplier|from)\s*[:-]\s*([A-Za-z0-9&.,'() -]{3,80})/i,
  );
  if (labelMatch?.[1]) {
    return labelMatch[1].trim();
  }

  return null;
}

function extractProductType(text: string): string | null {
  if (/\bdiesel\b|\bhsd\b|high\s*speed\s*diesel/i.test(text)) {
    return 'diesel';
  }
  if (/\bpetrol\b|\bms\b|motor\s*spirit/i.test(text)) {
    return 'petrol';
  }
  return null;
}

function extractQuantityLitres(text: string): number | null {
  const match = firstMatch(
    text,
    new RegExp(
      `(${NUMBER_TOKEN})\\s*(?:ltrs?\\.?|litres?|liters?|kl\\b|l)\\b`,
      'i',
    ),
  );
  if (!match) return null;
  const value = toNumber(match[1]);
  if (value === null) return null;
  // "KL" (kilolitres) is a real unit seen on tanker delivery challans —
  // convert to litres.
  if (/kl\b/i.test(match[0])) {
    return value * 1000;
  }
  return value;
}

function extractRatePerLitre(text: string): number | null {
  const match = firstMatch(
    text,
    new RegExp(
      `rate\\s*(?:\\/|per)?\\s*(?:ltr|litre|liter)?s?\\.?\\s*[:-]?\\s*(?:rs\\.?|inr|₹)?\\s*(${NUMBER_TOKEN})`,
      'i',
    ),
  );
  return match ? toNumber(match[1]) : null;
}

function extractAmount(text: string): number | null {
  // Prefer an explicit "Total"/"Grand Total"/"Amount Payable" label.
  const labelMatch = firstMatch(
    text,
    new RegExp(
      `(?:grand\\s*total|total\\s*amount|amount\\s*payable|net\\s*amount|bill\\s*amount|total)\\D{0,15}?(?:rs\\.?|inr|₹)\\s*(${NUMBER_TOKEN})`,
      'i',
    ),
  );
  if (labelMatch) {
    return toNumber(labelMatch[1]);
  }

  // A label without a currency symbol right next to it, e.g. "Total: 95000".
  const labelNoCurrency = firstMatch(
    text,
    new RegExp(
      `(?:grand\\s*total|total\\s*amount|amount\\s*payable|net\\s*amount|bill\\s*amount|total)\\s*[:-]?\\s*(${NUMBER_TOKEN})`,
      'i',
    ),
  );
  if (labelNoCurrency) {
    return toNumber(labelNoCurrency[1]);
  }

  // Fallback: collect every currency-tagged amount in the document and take
  // the largest — the invoice total is, in practice, the largest rupee
  // figure on a supplier invoice (larger than the per-litre rate or any
  // line-item tax breakup).
  const currencyMatches = Array.from(
    text.matchAll(new RegExp(`(?:rs\\.?|inr|₹)\\s*(${NUMBER_TOKEN})`, 'gi')),
  );
  const values = currencyMatches
    .map((m) => toNumber(m[1]))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

function extractInvoiceNo(text: string): string | null {
  const match = firstMatch(
    text,
    /(?:invoice\s*(?:no\.?|number)|challan\s*(?:no\.?|number)|inv\s*#|inv\s*no\.?)\s*[:-]?\s*([A-Za-z0-9/-]{2,30})/i,
  );
  return match?.[1]?.trim() ?? null;
}

function extractTankerNo(text: string): string | null {
  const match = firstMatch(text, VEHICLE_PLATE_REGEX);
  if (!match) return null;
  const [, part1, part2, part3, part4] = match;
  return `${part1}${part2}${part3}${part4}`.toUpperCase();
}

function extractInvoiceDate(text: string): string | null {
  const labelMatch = firstMatch(
    text,
    /date\s*[:-]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i,
  );
  if (labelMatch) return labelMatch[1];

  const bareMatch = firstMatch(text, /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/);
  return bareMatch?.[1] ?? null;
}

export function parseInvoiceText(text: string): ExtractedInvoiceFields {
  return {
    supplierName: extractSupplierName(text),
    productType: extractProductType(text),
    quantityLitres: extractQuantityLitres(text),
    ratePerLitre: extractRatePerLitre(text),
    amount: extractAmount(text),
    invoiceNo: extractInvoiceNo(text),
    tankerNo: extractTankerNo(text),
    invoiceDate: extractInvoiceDate(text),
  };
}
