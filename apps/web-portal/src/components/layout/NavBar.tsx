import { NavLink } from 'react-router-dom';

// Every Section 3 web-portal module now has a real page — this list used to
// carry a second, inert NOT_BUILT set of labels (Inventory, then Billing/
// Meter readings/Staff, then finally Settings) for nav items that existed
// in docs/master-plan.md's spec but had no page built yet. "Settings" was
// the last one; if a future section gets added to the spec before it's
// built, reintroduce that pattern rather than adding a dead link here.
const NAV_ITEMS: { label: string; to: string }[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Billing', to: '/billing' },
  { label: 'Meter readings', to: '/meter-readings' },
  { label: 'Staff', to: '/staff' },
  { label: 'Credit customers', to: '/customers' },
  { label: 'Loyalty', to: '/loyalty' },
  { label: 'Credit settings', to: '/credit-settings' },
  { label: 'Tank stock', to: '/tanks' },
  { label: 'Purchase entry', to: '/purchases' },
  { label: 'Variance report', to: '/variance-report' },
  { label: 'Rate master', to: '/rate-master' },
  { label: 'Cash custody', to: '/cash-custody' },
  { label: 'Reports', to: '/reports' },
  { label: 'Settings', to: '/settings' },
];

export function NavBar() {
  return (
    <div className="navbar">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }: { isActive: boolean }) =>
            isActive ? 'navlink active' : 'navlink'
          }
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
