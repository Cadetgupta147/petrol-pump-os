export type DateRangeTab = 'today' | 'yesterday' | 'week' | 'month';

const TABS: { key: DateRangeTab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

interface DateRangeTabsProps {
  active: DateRangeTab;
  onChange: (tab: DateRangeTab) => void;
}

// Section 3.1 — now genuinely wired: GET /dashboard/sales-summary takes an
// optional from/to (see api/dashboard.ts), and DashboardPage resolves each
// tab into a concrete YYYY-MM-DD pair (resolveDateRange()) before calling
// it. Every range-scoped widget (sales KPIs, payment collection, nozzle
// readings, product/rate chips) follows whichever tab is selected here —
// the tank-stock snapshot, recent-bills feed, and credit-limit alerts stay
// unscoped on purpose (they're current-state views, not day-scoped ones).
export function DateRangeTabs({ active, onChange }: DateRangeTabsProps) {
  return (
    <div className="date-tabs-group">
      <div className="date-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={tab.key === active ? 'date-tab active' : 'date-tab'}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
