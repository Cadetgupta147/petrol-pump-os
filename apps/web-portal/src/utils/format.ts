const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});

export function formatRupees(value: number): string {
  return `Rs. ${rupeeFormatter.format(Math.round(value))}`;
}

export function formatLitres(value: number): string {
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(value))} L`;
}

export function formatRatePerLitre(value: number): string {
  return `Rs. ${value.toFixed(2)}/L`;
}

export function formatSignedLitres(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded} L`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// "Today" per the browser's local calendar date — matches how
// dashboard.service.ts computes getStartAndEndOfToday() using server-local
// time. If the backend and browser sit in different timezones these two
// "today"s can disagree; there's no explicit timezone handling anywhere in
// this codebase yet (called out in dashboard.service.ts's own comments).
export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
