import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  ReceiptText,
  Zap,
  Wrench,
  FlaskConical,
  ShoppingCart,
  UsersRound,
  Warehouse,
  CircleDollarSign,
  ChevronDown,
  Ban,
  Smartphone,
  Droplet,
  Percent,
  BookOpen,
  Landmark,
  ListPlus,
  Table2,
  type LucideIcon,
} from 'lucide-react';

interface NavLeaf {
  label: string;
  to: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

// 18 modules is too many for a flat single-row bar (it overflowed into a
// horizontal-scroll strip — not a usable nav). Grouped into a handful of
// domain dropdowns instead; Dashboard/Staff/Reports/Settings stay top-level
// since they're single destinations, not a category.
const NAV_ENTRIES: NavEntry[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Sales',
    icon: ShoppingCart,
    children: [
      { label: 'Billing', to: '/billing', icon: Receipt },
      { label: 'Meter readings', to: '/meter-readings', icon: Gauge },
    ],
  },
  {
    label: 'Customers',
    icon: UsersRound,
    children: [
      { label: 'Credit customers', to: '/customers', icon: Wallet },
      { label: 'Loyalty', to: '/loyalty', icon: Star },
      { label: 'Credit settings', to: '/credit-settings', icon: ShieldCheck },
      { label: 'Vehicle blacklist', to: '/vehicle-blacklist', icon: Ban },
    ],
  },
  {
    label: 'Inventory & ops',
    icon: Warehouse,
    children: [
      { label: 'Tank stock', to: '/tanks', icon: Fuel },
      { label: 'Purchase entry', to: '/purchases', icon: Truck },
      { label: 'Variance report', to: '/variance-report', icon: Scale },
      { label: 'Rate master', to: '/rate-master', icon: Tag },
      { label: 'Density thresholds', to: '/density-range-settings', icon: Droplet },
      { label: 'Generator diesel', to: '/generator-diesel', icon: Zap },
      { label: 'Machine testing', to: '/machine-testing', icon: Wrench },
      { label: 'Lubricant & Urea sales', to: '/item-sales', icon: FlaskConical },
    ],
  },
  {
    label: 'Finance',
    icon: CircleDollarSign,
    children: [
      { label: 'Day book', to: '/day-book', icon: BookOpen },
      { label: 'Trial balance', to: '/trial-balance', icon: Table2 },
      { label: 'Voucher entry', to: '/vouchers', icon: ListPlus },
      { label: 'Ledger Master', to: '/ledger-accounts', icon: Landmark },
      { label: 'Cash custody', to: '/cash-custody', icon: Banknote },
      { label: 'Expenses', to: '/expenses', icon: ReceiptText },
      { label: 'UPI capture', to: '/upi-capture-settings', icon: Smartphone },
      { label: 'GST / tax rates', to: '/tax-rate-settings', icon: Percent },
    ],
  },
  { label: 'Staff', to: '/staff', icon: Users },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
];

export function NavBar() {
  const location = useLocation();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenGroup(null);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div className="navbar" ref={navRef}>
      {NAV_ENTRIES.map((entry) => {
        if (!isGroup(entry)) {
          return (
            <NavLink
              key={entry.to}
              to={entry.to}
              onClick={() => setOpenGroup(null)}
              className={({ isActive }: { isActive: boolean }) =>
                isActive ? 'navlink active' : 'navlink'
              }
            >
              <entry.icon size={14} strokeWidth={2.25} className="navlink-icon" />
              {entry.label}
            </NavLink>
          );
        }

        const isGroupActive = entry.children.some((child) => location.pathname.startsWith(child.to));
        const isOpen = openGroup === entry.label;

        return (
          <div className="nav-group" key={entry.label}>
            <button
              type="button"
              className={isGroupActive ? 'navlink nav-group-trigger active' : 'navlink nav-group-trigger'}
              aria-expanded={isOpen}
              onClick={() => setOpenGroup((prev) => (prev === entry.label ? null : entry.label))}
            >
              <entry.icon size={14} strokeWidth={2.25} className="navlink-icon" />
              {entry.label}
              <ChevronDown size={12} strokeWidth={2.5} className={isOpen ? 'nav-group-chevron open' : 'nav-group-chevron'} />
            </button>
            {isOpen && (
              <div className="nav-dropdown">
                {entry.children.map((child) => (
                  <NavLink
                    key={child.to}
                    to={child.to}
                    onClick={() => setOpenGroup(null)}
                    className={({ isActive }: { isActive: boolean }) =>
                      isActive ? 'nav-dropdown-item active' : 'nav-dropdown-item'
                    }
                  >
                    <child.icon size={14} strokeWidth={2.25} className="navlink-icon" />
                    {child.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
