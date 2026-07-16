export interface DashboardAlert {
  id: string;
  title: string;
  sub?: string;
  severity: 'red' | 'amber';
  onClick?: () => void;
}

interface AlertsPanelProps {
  alerts: DashboardAlert[];
}

export function AlertsPanel({ alerts }: AlertsPanelProps) {
  if (alerts.length === 0) {
    return <div className="card-sub">No alerts right now.</div>;
  }

  return (
    <div className="card">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="alert-row"
          style={{
            background: alert.severity === 'red' ? 'var(--red-bg)' : 'var(--amber-bg)',
          }}
          onClick={alert.onClick}
        >
          <div>
            <div
              className="alert-title"
              style={{ color: alert.severity === 'red' ? 'var(--red)' : 'var(--amber)' }}
            >
              {alert.title}
            </div>
            {alert.sub && (
              <div
                className="alert-sub"
                style={{ color: alert.severity === 'red' ? 'var(--red)' : 'var(--amber)' }}
              >
                {alert.sub}
              </div>
            )}
          </div>
          {alert.onClick && (
            <span style={{ color: alert.severity === 'red' ? 'var(--red)' : 'var(--amber)' }}>
              &rsaquo;
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
