import { NavLink } from 'react-router-dom';

// Only "Dashboard" and "Credit customers" go anywhere — every other tab is
// listed in docs/master-plan.md's nav (Section 3) but doesn't have a page
// built yet. They're shown as inert labels rather than dead links, so the
// nav communicates the intended shape of the product without pretending
// unbuilt sections work.
const BUILT: { label: string; to: string }[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Credit customers', to: '/customers' },
];

const NOT_BUILT = [
  'Billing',
  'Meter readings',
  'Loyalty',
  'Inventory',
  'Staff',
  'Reports',
  'Cash custody',
  'Settings',
];

export function NavBar() {
  return (
    <div className="navbar">
      {BUILT.map((item) => (
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
      {NOT_BUILT.map((label) => (
        <span key={label} className="navlink" title="Not built yet" style={{ cursor: 'default' }}>
          {label}
        </span>
      ))}
    </div>
  );
}
