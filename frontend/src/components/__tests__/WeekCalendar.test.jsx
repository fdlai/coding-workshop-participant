import { render, screen } from '@testing-library/react';
import WeekCalendar from '../WeekCalendar';
import { scheduleItem } from '../../test/fixtures';

describe('WeekCalendar', () => {
  const dayCell = (label) => screen.getByText(label).parentElement;

  it('renders Monday-first weeks starting from the week of startDate', () => {
    render(<WeekCalendar items={[]} startDate="2030-06-12" weeks={2} today="2030-06-12" />);
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('06-10')).toBeInTheDocument(); // Monday of that week
    expect(screen.getByText('06-23')).toBeInTheDocument(); // last Sunday of week 2
    expect(screen.queryByText('06-09')).not.toBeInTheDocument();
    expect(screen.queryByText('06-24')).not.toBeInTheDocument();
  });

  it('highlights today and weekends', () => {
    render(<WeekCalendar items={[]} startDate="2030-06-12" weeks={1} today="2030-06-12" />);
    expect(dayCell('06-12')).toHaveClass('bg-indigo-50');
    expect(dayCell('06-15')).toHaveClass('bg-slate-50');
    expect(dayCell('06-11')).toHaveClass('bg-white');
  });

  it('shows each assignment on the days it covers, skipping cancelled ones', () => {
    const items = [
      scheduleItem(1, { assignment: { start_date: '2030-06-11', effective_end_date: '2030-06-12' } }),
      scheduleItem(2, { assignment: { start_date: '2030-06-12', effective_end_date: '2030-06-12', state: 'cancelled' } }),
    ];
    render(<WeekCalendar items={items} startDate="2030-06-10" weeks={1} today="2030-06-12" />);
    const entries = screen.getAllByText('Project 1');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAttribute('title', 'Project 1 – Milestone 1');
    expect(dayCell('06-11')).toHaveTextContent('Project 1');
    expect(dayCell('06-13')).not.toHaveTextContent('Project');
    expect(screen.queryByText('Project 2')).not.toBeInTheDocument();
  });
});
