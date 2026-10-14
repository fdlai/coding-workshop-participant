import PropTypes from 'prop-types';
import { ApiError } from '../../services/api';

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  );
}
LoadingState.propTypes = { label: PropTypes.string };

export function EmptyState({ title, message, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {message && <p className="mt-1 text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
EmptyState.propTypes = {
  title: PropTypes.string.isRequired,
  message: PropTypes.string,
  action: PropTypes.node,
};

export function PermissionDenied({ message }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-12 text-center">
      <p className="text-lg font-semibold text-amber-900">Access denied</p>
      <p className="mt-1 text-sm text-amber-800">
        {message || 'You do not have permission to view this page.'}
      </p>
    </div>
  );
}
PermissionDenied.propTypes = { message: PropTypes.string };

/** Shows a 403 as permission-denied, anything else as a retryable error. */
export function ErrorState({ error, onRetry }) {
  if (error instanceof ApiError && error.status === 403) {
    return <PermissionDenied message={error.message} />;
  }
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center" role="alert">
      <p className="font-medium text-red-800">Something went wrong</p>
      <p className="mt-1 text-sm text-red-700">{error?.message || 'Unknown error'}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}
ErrorState.propTypes = { error: PropTypes.instanceOf(Error), onRetry: PropTypes.func };

/** Inline message for form/action failures. */
export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  const styles = kind === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}
Alert.propTypes = { kind: PropTypes.oneOf(['error', 'success']), children: PropTypes.node };

/** Renders loading / error states for a useFetch result, else calls children(data). */
export function Async({ state, children }) {
  if (state.loading && !state.data) return <LoadingState />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return children(state.data);
}
Async.propTypes = {
  state: PropTypes.shape({
    data: PropTypes.any,
    error: PropTypes.any,
    loading: PropTypes.bool,
    reload: PropTypes.func,
  }).isRequired,
  children: PropTypes.func.isRequired,
};
