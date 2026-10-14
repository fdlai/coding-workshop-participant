import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import { HOME_BY_ROLE } from './utils/roles';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import ManagerDashboard from './pages/ManagerDashboard';
import EmployeeDashboard from './pages/EmployeeDashboard';
import ProjectListPage from './pages/projects/ProjectListPage';
import ProjectDetailPage from './pages/projects/ProjectDetailPage';
import UsersPage from './pages/admin/UsersPage';
import OrganizationPage from './pages/admin/OrganizationPage';
import CompensationPage from './pages/admin/CompensationPage';
import AuditPage from './pages/admin/AuditPage';
import ArchivesPage from './pages/admin/ArchivesPage';
import TeamPage from './pages/TeamPage';
import SchedulePage from './pages/SchedulePage';
import ProfilePage from './pages/ProfilePage';

/** Unknown URLs go to the user's dashboard (or the login page when signed out). */
function Fallback() {
  const { user } = useAuth();
  return <Navigate to={user ? HOME_BY_ROLE[user.role] : '/'} replace />;
}

/** Route table. `/` is the login page, which redirects signed-in users to their dashboard. */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />

          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/organization" element={<OrganizationPage />} />
            <Route path="/admin/compensation" element={<CompensationPage />} />
            <Route path="/admin/audit" element={<AuditPage />} />
            <Route path="/admin/archives" element={<ArchivesPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={['manager']} />}>
            <Route path="/manager" element={<ManagerDashboard />} />
            <Route path="/team" element={<TeamPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={['employee']} />}>
            <Route path="/employee" element={<EmployeeDashboard />} />
          </Route>

          <Route element={<ProtectedRoute roles={['manager', 'employee']} />}>
            <Route path="/schedule" element={<SchedulePage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Fallback />} />
    </Routes>
  );
}
