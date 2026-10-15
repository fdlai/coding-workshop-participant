import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScheduleList from '../ScheduleList';
import { scheduleItem } from '../../test/fixtures';

describe('ScheduleList', () => {
  it('shows the default or custom empty title', () => {
    const { rerender } = render(<ScheduleList items={[]} />);
    expect(screen.getByText('No assignments')).toBeInTheDocument();
    rerender(<ScheduleList items={[]} emptyTitle="Nothing this week" />);
    expect(screen.getByText('Nothing this week')).toBeInTheDocument();
  });

  it('lists assignments with project link, milestone, dates and state', () => {
    render(
      <MemoryRouter>
        <ScheduleList items={[scheduleItem(1), scheduleItem(2, { assignment: { state: 'scheduled', start_date: '2030-07-01', effective_end_date: '2030-07-31' } })]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Project 1' })).toHaveAttribute('href', '/projects/11');
    expect(screen.getByText('Milestone 1')).toBeInTheDocument();
    expect(screen.getByText('Jun 10, 2030 – Jun 14, 2030')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Jul 1, 2030 – Jul 31, 2030')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });
});
