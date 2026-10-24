import { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { ExpenseListPage } from './pages/ExpenseListPage';
import { AddExpensePage } from './pages/AddExpensePage';
import { UploadPage } from './pages/UploadPage';
import { MileageEntryPage } from './pages/MileageEntryPage';
import { ExpenseReviewPage } from './pages/ExpenseReviewPage';
import { LoginPage } from './pages/LoginPage';
import { ApprovalQueuePage } from './pages/ApprovalQueuePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminSettingsPage } from './pages/AdminSettingsPage';
import { AppShell } from './components/AppShell';
import { useAuth } from './auth/AuthContext';
import { useModules } from './workspace/ModulesContext';
import { canHandlePurchaseInvoices } from './workspace/permissions';
import { AppModule, Role } from './types';

function RequireRole({ roles, children }: { roles: Role[]; children: ReactElement }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

// A module switched off in Settings has no pages; the server refuses its API too.
function RequireModule({ module, children }: { module: AppModule; children: ReactElement }) {
  const { has } = useModules();
  return has(module) ? children : <Navigate to="/" replace />;
}

// Purchase invoices: the module and the accountant (or admin) role.
function InvoicesOnly({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (!user || !canHandlePurchaseInvoices(user.role)) return <Navigate to="/" replace />;
  return <RequireModule module="PURCHASE_INVOICES">{children}</RequireModule>;
}

// Every authenticated route goes through here: redirect to /login if signed
// out, otherwise wrap the page in the sidebar/mobile-nav shell — once the
// organization's modules are known, so menus and pages don't flash.
function Protected({ children }: { children: ReactElement }) {
  const { isAuthenticated } = useAuth();
  const { ready } = useModules();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (!ready) return null;
  return <AppShell>{children}</AppShell>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route
        path="/expenses"
        element={
          <Protected>
            <RequireModule module="EXPENSES">
              <ExpenseListPage />
            </RequireModule>
          </Protected>
        }
      />
      <Route
        path="/upload"
        element={
          <Protected>
            <AddExpensePage />
          </Protected>
        }
      />
      <Route
        path="/upload/receipt"
        element={
          <Protected>
            <RequireModule module="EXPENSES">
              <UploadPage />
            </RequireModule>
          </Protected>
        }
      />
      <Route
        path="/upload/mileage"
        element={
          <Protected>
            <RequireModule module="EXPENSES">
              <MileageEntryPage />
            </RequireModule>
          </Protected>
        }
      />
      <Route
        path="/expenses/:id"
        element={
          <Protected>
            <ExpenseReviewPage />
          </Protected>
        }
      />
      <Route
        path="/invoices"
        element={
          <Protected>
            <InvoicesOnly>
              <ExpenseListPage module="PURCHASE_INVOICES" />
            </InvoicesOnly>
          </Protected>
        }
      />
      <Route
        path="/invoices/upload"
        element={
          <Protected>
            <InvoicesOnly>
              <UploadPage expenseType="PURCHASE_INVOICE" />
            </InvoicesOnly>
          </Protected>
        }
      />
      {/* The same review page as expenses: it adapts to the purchase-invoice type. */}
      <Route
        path="/invoices/:id"
        element={
          <Protected>
            <InvoicesOnly>
              <ExpenseReviewPage />
            </InvoicesOnly>
          </Protected>
        }
      />
      <Route
        path="/approvals"
        element={
          <Protected>
            <RequireModule module="EXPENSES">
              <RequireRole roles={['APPROVER', 'ADMIN']}>
                <ApprovalQueuePage />
              </RequireRole>
            </RequireModule>
          </Protected>
        }
      />
      <Route
        path="/admin/users"
        element={
          <Protected>
            <RequireRole roles={['ADMIN']}>
              <AdminUsersPage />
            </RequireRole>
          </Protected>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <Protected>
            <RequireRole roles={['ADMIN']}>
              <AdminSettingsPage />
            </RequireRole>
          </Protected>
        }
      />
    </Routes>
  );
}

export default App;
