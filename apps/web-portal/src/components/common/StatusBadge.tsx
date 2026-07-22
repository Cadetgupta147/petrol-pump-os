import { AlertTriangle, CheckCircle2, Clock, HelpCircle } from 'lucide-react';

export type StatusTone = 'good' | 'warning' | 'critical' | 'neutral';

interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
}

// Shared status chip — icon + label, never color alone (a status color must
// never be the only signal, since it can't be told apart from a nearby
// series color by everyone, and reads as pure decoration to a screen
// reader). Reuses this app's existing red/amber/green status colors rather
// than introducing a second status ramp — those are already used
// consistently for "flagged"/"within tolerance"/"shift open" across the
// Dashboard, Meter Readings, and Reports pages.
const TONE = {
  good: { icon: CheckCircle2, color: 'var(--green)', background: 'var(--green-bg)' },
  warning: { icon: Clock, color: 'var(--amber)', background: 'var(--amber-bg)' },
  critical: { icon: AlertTriangle, color: 'var(--red)', background: 'var(--red-bg)' },
  neutral: { icon: HelpCircle, color: 'var(--gray)', background: 'var(--page-bg)' },
} as const;

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  const { icon: Icon, color, background } = TONE[tone];
  return (
    <span className="badge status-badge" style={{ background, color }}>
      <Icon size={12} strokeWidth={2.5} />
      {label}
    </span>
  );
}
