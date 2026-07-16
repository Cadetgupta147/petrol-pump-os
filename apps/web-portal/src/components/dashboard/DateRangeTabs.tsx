const TABS = ['Today', 'Yesterday', 'This week', 'This month'];

// Honest limitation, not a cut corner: /dashboard/sales-summary hardcodes
// "today" server-side (getStartAndEndOfToday() in dashboard.service.ts) with
// no date/range query param. Wiring Yesterday/This week/This month here
// would mean either faking a filter that doesn't do anything, or silently
// re-deriving ranges client-side from /bills (imprecise, and a much bigger
// data pull). Neither is "wired to a real endpoint", so those tabs stay
// visibly disabled until the backend grows a range parameter.
export function DateRangeTabs() {
  return (
    <div className="date-tabs-group">
      <div className="date-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={tab === 'Today' ? 'date-tab active' : 'date-tab'}
            disabled={tab !== 'Today'}
            title={
              tab === 'Today'
                ? undefined
                : 'Backend has no date-range parameter yet — /dashboard endpoints only compute "today"'
            }
          >
            {tab}
          </button>
        ))}
      </div>
      <span className="date-note">Only &ldquo;Today&rdquo; is wired — the backend has no date-range parameter yet</span>
    </div>
  );
}
