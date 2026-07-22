import { useEffect, useState } from 'react';
import { useAuth } from '../../context/useAuth';
import { getBusinessProfile } from '../../api/businessProfile';

export function TopBar() {
  const { staff, logout } = useAuth();

  // Multi-tenancy Phase 6 (docs/multi-tenancy-plan.md) — this used to be a
  // hardcoded placeholder ("nothing in the schema stores a pump/dealer name
  // anywhere"); Section 3.9's BusinessProfile.businessName is exactly that
  // now-real settings entity. GET /business-profile stays Owner/Accountant
  // only server-side (Section 2) — deliberately NOT widened here just to
  // show a name in the header, so Manager/DSM/Read-only fall back to the
  // generic "PumpOS" brand instead of a per-pump name, same as if the
  // fetch fails for any other reason.
  const [pumpName, setPumpName] = useState<string | null>(null);

  useEffect(() => {
    if (staff?.role !== 'OWNER' && staff?.role !== 'ACCOUNTANT') return;
    let cancelled = false;
    getBusinessProfile()
      .then((profile) => {
        if (!cancelled && profile.businessName) setPumpName(profile.businessName);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [staff?.role]);

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
        {pumpName && (
          <>
            <div className="topbar-divider" />
            <div>
              <div className="topbar-pump">{pumpName}</div>
              <div className="topbar-sub">Dealer dashboard</div>
            </div>
          </>
        )}
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
