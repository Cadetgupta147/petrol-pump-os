import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  dotColor?: string;
  icon?: LucideIcon;
  valueColor?: string;
  background?: string;
  borderColor?: string;
  onSubClick?: () => void;
}

export function KpiCard({
  label,
  value,
  sub,
  dotColor,
  icon: Icon,
  valueColor,
  background,
  borderColor,
  onSubClick,
}: KpiCardProps) {
  return (
    <div
      className="card"
      style={{
        background: background,
        borderColor: borderColor,
      }}
    >
      <div className="card-label">
        {Icon ? (
          <Icon size={13} strokeWidth={2.25} style={{ color: dotColor ?? 'var(--gray)', flexShrink: 0 }} />
        ) : (
          dotColor && <span className="dot" style={{ background: dotColor }} />
        )}
        {label.toUpperCase()}
      </div>
      <div className="card-value" style={{ color: valueColor }}>
        {value}
      </div>
      {sub &&
        (onSubClick ? (
          <button className="card-sub clickable" onClick={onSubClick}>
            {sub} &rsaquo;
          </button>
        ) : (
          <div className="card-sub">{sub}</div>
        ))}
    </div>
  );
}
