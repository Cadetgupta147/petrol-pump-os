import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerLedgerPage } from './pages/CustomerLedgerPage';
import { BillDetailPage } from './pages/BillDetailPage';

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
        path="/bills/:id"
        element={
          <RequireAuth>
            <BillDetailPage />
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
