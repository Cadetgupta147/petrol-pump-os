import { NavLink } from 'react-router-dom';

// "Inventory" used to be a single inert NOT_BUILT placeholder covering
// Section 7's whole module — now split into its four real built pages
// (Tank Stock, Purchase Entry, Variance Report, Rate Master). "Billing" was
// the same kind of placeholder for Section 3.2's bill register — now built
// (BillingRegisterPage, filters + pagination against GET /bills). Every
// other tab still listed in docs/master-plan.md's nav (Section 3) but
// without a page built yet stays an inert label rather than a dead link, so
// the nav communicates the intended shape of the product without
// pretending unbuilt sections work.
const BUILT: { label: string; to: string }[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Billing', to: '/billing' },
  { label: 'Credit customers', to: '/customers' },
  { label: 'Loyalty', to: '/loyalty' },
  { label: 'Credit settings', to: '/credit-settings' },
  { label: 'Tank stock', to: '/tanks' },
  { label: 'Purchase entry', to: '/purchases' },
  { label: 'Variance report', to: '/variance-report' },
  { label: 'Rate master', to: '/rate-master' },
  { label: 'Cash custody', to: '/cash-custody' },
  { label: 'Reports', to: '/reports' },
];

const NOT_BUILT = [
  'Meter readings',
  'Staff',
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
