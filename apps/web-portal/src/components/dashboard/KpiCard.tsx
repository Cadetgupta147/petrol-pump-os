interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  dotColor?: string;
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
        {dotColor && <span className="dot" style={{ background: dotColor }} />}
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
