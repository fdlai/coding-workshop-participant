import { render, screen } from '@testing-library/react';
import { Avatar, Card, DonutChart, MetricCard, PageHeader, ProgressBar, StatusBadge } from '../Display';

describe('StatusBadge', () => {
  it.each([
    ['on_track', 'On track', 'bg-emerald-100'],
    ['at_risk', 'At risk', 'bg-amber-100'],
    ['over_budget', 'Over budget', 'bg-red-100'],
    ['admin', 'Admin', 'bg-purple-100'],
    ['completed', 'Completed', 'bg-blue-100'],
    ['something_new', 'Something new', 'bg-slate-100'],
  ])('renders %s as "%s" with its tone', (status, text, tone) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toHaveClass(tone);
  });

  it('prefers an explicit label', () => {
    render(<StatusBadge status="active" label="Available" />);
    expect(screen.getByText('Available')).toHaveClass('bg-emerald-100');
  });
});

describe('Avatar', () => {
  it('shows the profile picture when set', () => {
    render(<Avatar person={{ first_name: 'Ada', last_name: 'Admin', profile_picture_url: 'https://x.test/a.png' }} size="lg" />);
    const img = screen.getByRole('img', { name: 'Ada Admin' });
    expect(img).toHaveAttribute('src', 'https://x.test/a.png');
    expect(img).toHaveClass('h-14');
  });

  it('falls back to initials, or ? when there is no person', () => {
    const { rerender } = render(<Avatar person={{ first_name: 'max', last_name: 'manager' }} />);
    expect(screen.getByText('MM')).toHaveClass('h-9');
    rerender(<Avatar person={null} size="sm" />);
    expect(screen.getByText('?')).toHaveClass('h-7');
  });
});

describe('ProgressBar', () => {
  it.each([
    [42, '42'],
    [150, '100'],
    [-5, '0'],
    [undefined, '0'],
    [63.5, '63.5'],
  ])('clamps %p to %s', (percent, expected) => {
    render(<ProgressBar percent={percent} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected);
  });

  it('applies the tone color', () => {
    render(<ProgressBar percent={50} tone="red" />);
    expect(screen.getByRole('progressbar').firstChild).toHaveClass('bg-red-500');
    expect(screen.getByRole('progressbar').firstChild).toHaveStyle({ width: '50%' });
  });
});

describe('MetricCard', () => {
  it('shows label, value and hint with the tone color', () => {
    const { rerender } = render(<MetricCard label="At risk" value={3} hint="of 10" tone="amber" />);
    expect(screen.getByText('3')).toHaveClass('text-amber-600');
    expect(screen.getByText('of 10')).toBeInTheDocument();
    rerender(<MetricCard label="Over" value="2" tone="red" />);
    expect(screen.getByText('2')).toHaveClass('text-red-600');
    rerender(<MetricCard label="Plain" value={0} />);
    expect(screen.getByText('0')).toHaveClass('text-slate-900');
    expect(screen.queryByText('of 10')).not.toBeInTheDocument();
  });
});

describe('Card and PageHeader', () => {
  it('renders a card with title and actions, or without a header', () => {
    const { rerender } = render(<Card title="Budget" actions={<button type="button">Edit</button>}>Content</Card>);
    expect(screen.getByRole('heading', { name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    rerender(<Card>Only content</Card>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('Only content')).toBeInTheDocument();
  });

  it('renders the page title with optional subtitle and actions', () => {
    const { rerender } = render(<PageHeader title="Projects" subtitle="All of them" actions={<button type="button">New</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('All of them')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    rerender(<PageHeader title="Bare" />);
    expect(screen.queryByText('All of them')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('DonutChart', () => {
  const segments = [
    { label: 'On track', value: 3, color: '#10b981', tooltip: 'Under 95%' },
    { label: 'At risk', value: 1, color: '#f59e0b' },
  ];

  it('draws one arc per segment proportional to its value, with a legend', () => {
    const { container } = render(<DonutChart segments={segments} />);
    expect(screen.getByRole('img', { name: 'Budget health distribution' })).toBeInTheDocument();
    const arcs = container.querySelectorAll('circle[stroke-dasharray]');
    expect(arcs).toHaveLength(2);
    const circumference = 2 * Math.PI * 40;
    const [first] = arcs[0].getAttribute('stroke-dasharray').split(' ').map(Number);
    expect(first).toBeCloseTo(circumference * 0.75);
    expect(Number(arcs[1].getAttribute('stroke-dashoffset'))).toBeCloseTo(-circumference * 0.75);
    expect(screen.getByText('On track').closest('li')).toHaveTextContent('On track3Under 95%');
  });

  it('shows tooltips only for segments that have one, and makes them focusable', () => {
    render(<DonutChart segments={segments} />);
    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(screen.getByText('On track').closest('li')).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('At risk').closest('li')).not.toHaveAttribute('tabindex');
  });

  it('draws only the empty ring when every value is zero', () => {
    const { container } = render(<DonutChart segments={segments.map((s) => ({ ...s, value: 0 }))} />);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });
});
