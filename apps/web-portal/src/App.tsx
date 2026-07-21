import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerLedgerPage } from './pages/CustomerLedgerPage';
import { BillDetailPage } from './pages/BillDetailPage';
import { BillingRegisterPage } from './pages/BillingRegisterPage';
import { MeterReadingsPage } from './pages/MeterReadingsPage';
import { StaffPage } from './pages/StaffPage';
import { LoyaltySettingsPage } from './pages/LoyaltySettingsPage';
import { CreditSettingsPage } from './pages/CreditSettingsPage';
import { TanksPage } from './pages/TanksPage';
import { PurchaseEntryPage } from './pages/PurchaseEntryPage';
import { VarianceReportPage } from './pages/VarianceReportPage';
import { RateMasterPage } from './pages/RateMasterPage';
import { CashCustodyPage } from './pages/CashCustodyPage';
import { CashCustodyStatusPage } from './pages/CashCustodyStatusPage';
import { ReportsPage } from './pages/ReportsPage';

// Root path just forwards to whichever of /dashboard or /login is correct
// for the current auth state, rather than being its own page.
function RootRedirect() {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/customers"
        element={
          <RequireAuth>
            <CustomersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/customers/:id"
        element={
          <RequireAuth>
            <CustomerLedgerPage />
          </RequireAuth>
        }
      />
      <Route
        path="/loyalty"
        element={
          <RequireAuth>
            <LoyaltySettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/credit-settings"
        element={
          <RequireAuth>
            <CreditSettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/billing"
        element={
          <RequireAuth>
            <BillingRegisterPage />
          </RequireAuth>
        }
      />
      <Route
        path="/meter-readings"
        element={
          <RequireAuth>
            <MeterReadingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/staff"
        element={
          <RequireAuth>
            <StaffPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bills/:id"
        element={
          <RequireAuth>
            <BillDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tanks"
        element={
          <RequireAuth>
            <TanksPage />
          </RequireAuth>
        }
      />
      <Route
        path="/purchases"
        element={
          <RequireAuth>
            <PurchaseEntryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/variance-report"
        element={
          <RequireAuth>
            <VarianceReportPage />
          </RequireAuth>
        }
      />
      <Route
        path="/rate-master"
        element={
          <RequireAuth>
            <RateMasterPage />
          </RequireAuth>
        }
      />
      <Route
        path="/cash-custody"
        element={
          <RequireAuth>
            <CashCustodyPage />
          </RequireAuth>
        }
      />
      <Route
        path="/cash-custody/status"
        element={
          <RequireAuth>
            <CashCustodyStatusPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reports"
        element={
          <RequireAuth>
            <ReportsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
