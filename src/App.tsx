import { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { ExpenseListPage } from './pages/ExpenseListPage';
import { UploadPage } from './pages/UploadPage';
import { ExpenseReviewPage } from './pages/ExpenseReviewPage';
import { LoginPage } from './pages/LoginPage';
import { ApprovalQueuePage } from './pages/ApprovalQueuePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AppShell } from './components/AppShell';
import { useAuth } from './auth/AuthContext';
import { Role } from './types';

function RequireRole({ roles, children }: { roles: Role[]; children: ReactElement }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

// Every authenticated route goes through here: redirect to /login if signed
// out, otherwise wrap the page in the sidebar/mobile-nav shell.
function Protected({ children }: { children: ReactElement }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
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
            <ExpenseListPage />
          </Protected>
        }
      />
      <Route
        path="/upload"
        element={
          <Protected>
            <UploadPage />
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
        path="/approvals"
        element={
          <Protected>
            <RequireRole roles={['APPROVER', 'ADMIN']}>
              <ApprovalQueuePage />
            </RequireRole>
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
    </Routes>
  );
}

export default App;
