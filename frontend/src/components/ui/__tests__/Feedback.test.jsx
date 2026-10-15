import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alert, Async, EmptyState, ErrorState, LoadingState, PermissionDenied } from '../Feedback';
import { ApiError } from '../../../services/api';

describe('LoadingState', () => {
  it('announces loading with a default or custom label', () => {
    const { rerender } = render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    rerender(<LoadingState label="Restoring…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Restoring…');
  });
});

describe('EmptyState', () => {
  it('shows a title with optional message and action', () => {
    const { rerender } = render(<EmptyState title="No projects" message="Create one" action={<button type="button">New</button>} />);
    expect(screen.getByText('No projects')).toBeInTheDocument();
    expect(screen.getByText('Create one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    rerender(<EmptyState title="Nothing" />);
    expect(screen.queryByText('Create one')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('PermissionDenied', () => {
  it('shows a default or custom message', () => {
    const { rerender } = render(<PermissionDenied />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText('You do not have permission to view this page.')).toBeInTheDocument();
    rerender(<PermissionDenied message="Managers only" />);
    expect(screen.getByText('Managers only')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('treats a 403 as permission denied', () => {
    render(<ErrorState error={new ApiError(403, 'Not your project')} />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText('Not your project')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows other errors with a retry button', async () => {
    const onRetry = jest.fn();
    render(<ErrorState error={new ApiError(500, 'Database unavailable')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('alert')).toHaveTextContent('Database unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message and hides retry without a handler', () => {
    render(<ErrorState error={new Error('')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown error');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Alert', () => {
  it('renders nothing without content', () => {
    const { container } = render(<Alert>{''}</Alert>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders errors as alerts and successes as status', () => {
    const { rerender } = render(<Alert>Failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    rerender(<Alert kind="success">Saved</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('status')).toHaveClass('bg-emerald-50');
  });
});

describe('Async', () => {
  const child = (data) => <p>Data: {data}</p>;

  it('shows loading before the first data arrives', () => {
    render(<Async state={{ loading: true, data: null, error: null }}>{child}</Async>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('keeps showing data while reloading', () => {
    render(<Async state={{ loading: true, data: 'old', error: null }}>{child}</Async>);
    expect(screen.getByText('Data: old')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the error with retry wired to reload', async () => {
    const reload = jest.fn();
    render(<Async state={{ loading: false, data: null, error: new Error('Down'), reload }}>{child}</Async>);
    expect(screen.getByRole('alert')).toHaveTextContent('Down');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalled();
  });

  it('renders children with the data', () => {
    render(<Async state={{ loading: false, data: 'ready', error: null }}>{child}</Async>);
    expect(screen.getByText('Data: ready')).toBeInTheDocument();
  });
});
