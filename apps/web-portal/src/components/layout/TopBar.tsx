import { useAuth } from '../../context/useAuth';

// Pump name is a placeholder until Section 3 grows a real "business
// settings" entity to read it from — nothing in the current schema stores
// a pump/dealer name anywhere (Staff and Customer are the only "identity"
// models). Swap PUMP_NAME once that settings entity exists.
const PUMP_NAME = 'Shree Balaji Petrol Pump';

export function TopBar() {
  const { staff, logout } = useAuth();

  const initials = staff
    ? staff.name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?';

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <div className="topbar-drop" />
        <span className="topbar-title">PumpOS</span>
        <div className="topbar-divider" />
        <div>
          <div className="topbar-pump">{PUMP_NAME}</div>
          <div className="topbar-sub">Dealer dashboard</div>
        </div>
      </div>
      <div className="topbar-profile">
        <div className="topbar-profile-text">
          <div className="topbar-profile-label">Logged in as</div>
          <div className="topbar-profile-name">
            {staff ? `${staff.name} (${staff.role})` : 'Unknown'}
          </div>
        </div>
        <button
          className="avatar"
          onClick={logout}
          title="Log out"
          style={{ border: 'none' }}
        >
          {initials}
        </button>
      </div>
    </div>
  );
}
