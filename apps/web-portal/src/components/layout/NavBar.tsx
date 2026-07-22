import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Gauge,
  Users,
  Wallet,
  Star,
  ShieldCheck,
  Fuel,
  Truck,
  Scale,
  Tag,
  Banknote,
  BarChart3,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

// Every Section 3 web-portal module now has a real page — this list used to
// carry a second, inert NOT_BUILT set of labels (Inventory, then Billing/
// Meter readings/Staff, then finally Settings) for nav items that existed
// in docs/master-plan.md's spec but had no page built yet. "Settings" was
// the last one; if a future section gets added to the spec before it's
// built, reintroduce that pattern rather than adding a dead link here.
const NAV_ITEMS: { label: string; to: string; icon: LucideIcon }[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Billing', to: '/billing', icon: Receipt },
  { label: 'Meter readings', to: '/meter-readings', icon: Gauge },
  { label: 'Staff', to: '/staff', icon: Users },
  { label: 'Credit customers', to: '/customers', icon: Wallet },
  { label: 'Loyalty', to: '/loyalty', icon: Star },
  { label: 'Credit settings', to: '/credit-settings', icon: ShieldCheck },
  { label: 'Tank stock', to: '/tanks', icon: Fuel },
  { label: 'Purchase entry', to: '/purchases', icon: Truck },
  { label: 'Variance report', to: '/variance-report', icon: Scale },
  { label: 'Rate master', to: '/rate-master', icon: Tag },
  { label: 'Cash custody', to: '/cash-custody', icon: Banknote },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
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
          <item.icon size={14} strokeWidth={2.25} className="navlink-icon" />
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
