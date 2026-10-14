import { Navigate, Outlet } from 'react-router-dom';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import { LoadingState, PermissionDenied } from '../ui/Feedback';

/**
 * Route guard. Unauthenticated users go to the login page; users whose role is
 * not in `roles` see a permission-denied page. (The API enforces the same rules.)
 */
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState label="Restoring your session…" />;
  if (!user) return <Navigate to="/" replace />;
  if (roles && !roles.includes(user.role)) return <PermissionDenied />;
  return <Outlet />;
}

ProtectedRoute.propTypes = { roles: PropTypes.arrayOf(PropTypes.string) };
