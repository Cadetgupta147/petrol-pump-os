import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { CreditAgingReportTab } from '../components/reports/CreditAgingReportTab';
import { LoyaltyCostReportTab } from '../components/reports/LoyaltyCostReportTab';
import { GiftRedemptionReportTab } from '../components/reports/GiftRedemptionReportTab';
import { SalesPurchaseRegisterTab } from '../components/reports/SalesPurchaseRegisterTab';
import { AttendanceSummaryTab } from '../components/reports/AttendanceSummaryTab';

// Section 12 — Reports & Analytics hub. Stock variance and cash custody
// already have their own dedicated pages built in earlier slices — this hub
// links out to both rather than rebuilding them (per this slice's explicit
// instruction), and hosts the five reports built in this slice as tabs.
//
// IA judgment call: a single hub page with client-side tabs (not five
// separate routes) — these are all read-only report views with no deep-link/
// bookmark need beyond "the reports page", so nested routing would add
// ceremony without a real benefit. Matches "your call on IA" from the task
// spec.
type TabKey = 'credit-aging' | 'loyalty-cost' | 'gift-redemption' | 'gst-register' | 'attendance';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'credit-aging', label: 'Credit aging' },
  { key: 'loyalty-cost', label: 'Loyalty cost' },
  { key: 'gift-redemption', label: 'Gift redemption' },
  { key: 'gst-register', label: 'GST sales/purchase register' },
  { key: 'attendance', label: 'Staff attendance' },
];

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('credit-aging');

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>Reports &amp; analytics</h3>
          <span className="section-note">Section 12 — full report list</span>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Already built elsewhere</h3>
          </div>
          <div className="grid grid-2">
            <Link to="/variance-report" className="card" style={{ textDecoration: 'none' }}>
              <div className="card-label">STOCK VARIANCE REPORT</div>
              <div className="card-sub">Purchased − sold − physical DIP = variance &rsaquo;</div>
            </Link>
            <Link to="/cash-custody/status" className="card" style={{ textDecoration: 'none' }}>
              <div className="card-label">CASH CUSTODY REPORT</div>
              <div className="card-sub">Who&rsquo;s holding pump cash outside premises, and for how long &rsaquo;</div>
            </Link>
          </div>
        </div>

        <div className="section">
          <div className="date-tabs-group" style={{ marginBottom: 20 }}>
            <div className="date-tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={activeTab === tab.key ? 'date-tab active' : 'date-tab'}
                  onClick={() => setActiveTab(tab.key)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'credit-aging' && <CreditAgingReportTab />}
          {activeTab === 'loyalty-cost' && <LoyaltyCostReportTab />}
          {activeTab === 'gift-redemption' && <GiftRedemptionReportTab />}
          {activeTab === 'gst-register' && <SalesPurchaseRegisterTab />}
          {activeTab === 'attendance' && <AttendanceSummaryTab />}
        </div>
      </div>
    </>
  );
}
