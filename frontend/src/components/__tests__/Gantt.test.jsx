import { render, screen } from '@testing-library/react';
import Gantt from '../Gantt';

const milestones = [
  { id: 1, name: 'Design', start_date: '2030-06-01', end_date: '2030-06-10', status: 'completed' },
  { id: 2, name: 'Build', start_date: '2030-06-11', end_date: '2030-06-30', status: 'pending' },
  { id: 3, name: 'Pilot', start_date: '2030-06-21', end_date: '2030-06-25', status: 'cancelled' },
  { id: 4, name: 'Mystery', start_date: '2030-06-05', end_date: '2030-06-05', status: 'weird' },
];

const bar = (name) => screen.getByText(name).parentElement;

describe('Gantt', () => {
  it('renders nothing without milestones', () => {
    const { container } = render(<Gantt milestones={[]} today="2030-06-12" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the overall date range and positions bars by date', () => {
    render(<Gantt milestones={milestones} today="2030-06-12" />);
    expect(screen.getByText('Jun 1, 2030')).toBeInTheDocument();
    expect(screen.getByText('Jun 30, 2030')).toBeInTheDocument();

    // 30-day span: Design covers days 0-9, Build days 10-29.
    expect(bar('Design')).toHaveStyle({ left: '0%' });
    expect(parseFloat(bar('Design').style.width)).toBeCloseTo(33.33, 1);
    expect(parseFloat(bar('Build').style.left)).toBeCloseTo(33.33, 1);
    expect(parseFloat(bar('Build').style.width)).toBeCloseTo(66.67, 1);
    expect(bar('Build')).toHaveAttribute('title', 'Build: Jun 11, 2030 – Jun 30, 2030');
  });

  it('derives the range from the earliest start and latest end, whatever the order', () => {
    const unsorted = [
      { id: 2, name: 'Later', start_date: '2030-06-11', end_date: '2030-06-20', status: 'pending' },
      { id: 1, name: 'Earlier', start_date: '2030-06-01', end_date: '2030-06-05', status: 'pending' },
    ];
    render(<Gantt milestones={unsorted} today="2030-06-12" />);
    expect(screen.getByText('Jun 1, 2030')).toBeInTheDocument();
    expect(screen.getByText('Jun 20, 2030')).toBeInTheDocument();
    expect(bar('Earlier')).toHaveStyle({ left: '0%' });
  });

  it('colors bars by status, defaulting unknown statuses to pending', () => {
    render(<Gantt milestones={milestones} today="2030-06-12" />);
    expect(bar('Design')).toHaveClass('bg-emerald-500');
    expect(bar('Build')).toHaveClass('bg-indigo-500');
    expect(bar('Pilot')).toHaveClass('bg-slate-400');
    expect(bar('Mystery')).toHaveClass('bg-indigo-500');
  });

  it('keeps tiny bars visible with a minimum width', () => {
    const many = [
      { id: 1, name: 'Long', start_date: '2030-01-01', end_date: '2030-12-31', status: 'pending' },
      { id: 2, name: 'Day', start_date: '2030-06-01', end_date: '2030-06-01', status: 'pending' },
    ];
    render(<Gantt milestones={many} today="2030-06-12" />);
    expect(bar('Day')).toHaveStyle({ width: '2%' });
  });

  it('marks today only when it falls inside the range', () => {
    const { rerender } = render(<Gantt milestones={milestones} today="2030-06-16" />);
    expect(screen.getByTitle('Today')).toHaveStyle({ left: '50%' });
    rerender(<Gantt milestones={milestones} today="2030-07-15" />);
    expect(screen.queryByTitle('Today')).not.toBeInTheDocument();
    rerender(<Gantt milestones={milestones} today="2030-05-01" />);
    expect(screen.queryByTitle('Today')).not.toBeInTheDocument();
  });
});
