import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert } from './Feedback';

const buttonStyles = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-indigo-600 hover:bg-indigo-50',
};

export function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  const sizes = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button
      type="button"
      className={`rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed ${sizes} ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}
Button.propTypes = {
  variant: PropTypes.oneOf(['primary', 'secondary', 'danger', 'ghost']),
  size: PropTypes.oneOf(['sm', 'md']),
  className: PropTypes.string,
};

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100';

/** Label + control wrapper. Pass the control as children. */
export function Field({ label, htmlFor, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
Field.propTypes = {
  label: PropTypes.string.isRequired,
  htmlFor: PropTypes.string,
  hint: PropTypes.string,
  children: PropTypes.node.isRequired,
};

export function TextInput(props) {
  return <input className={inputClass} {...props} />;
}

export function SelectInput({ children, ...props }) {
  return <select className={inputClass} {...props}>{children}</select>;
}
SelectInput.propTypes = { children: PropTypes.node };

export function TextArea(props) {
  return <textarea rows={3} className={inputClass} {...props} />;
}

/** Search box + any filter controls laid out in a row. */
export function FilterBar({ children }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}
FilterBar.propTypes = { children: PropTypes.node };

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
Modal.propTypes = {
  title: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  children: PropTypes.node,
  wide: PropTypes.bool,
};

/**
 * Form modal: runs `onSubmit` (async), shows any API error inline, and closes
 * itself via `onDone` on success.
 */
export function FormModal({ title, onClose, onSubmit, submitLabel = 'Save', children, wide, danger = false }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit();
      onClose(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={() => onClose(false)} wide={wide}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {children}
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => onClose(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
            {busy ? 'Working…' : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
FormModal.propTypes = {
  title: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  submitLabel: PropTypes.string,
  children: PropTypes.node,
  wide: PropTypes.bool,
  danger: PropTypes.bool,
};

/** Yes/no confirmation for consequential actions. */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onClose }) {
  return (
    <FormModal title={title} onClose={onClose} onSubmit={onConfirm} submitLabel={confirmLabel} danger={danger}>
      <p className="text-sm text-slate-600">{message}</p>
    </FormModal>
  );
}
ConfirmDialog.propTypes = {
  title: PropTypes.string.isRequired,
  message: PropTypes.string.isRequired,
  confirmLabel: PropTypes.string,
  danger: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export function Pagination({ offset, limit, total, onChange }) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}
Pagination.propTypes = {
  offset: PropTypes.number.isRequired,
  limit: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

/**
 * Responsive table. `columns`: [{key, header, render?(row)}].
 * Wrapped in a horizontal scroller so it works on narrow screens.
 */
export function DataTable({ columns, rows, rowKey = 'id', onRowClick }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-4 py-3 text-left font-medium text-slate-500">{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}
            >
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-3 align-middle text-slate-700">
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
DataTable.propTypes = {
  columns: PropTypes.arrayOf(
    PropTypes.shape({ key: PropTypes.string, header: PropTypes.node, render: PropTypes.func }),
  ).isRequired,
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  rowKey: PropTypes.string,
  onRowClick: PropTypes.func,
};
