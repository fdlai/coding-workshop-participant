import {
  addDays,
  assignmentDisplayState,
  capitalize,
  coversDay,
  daysBetween,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyCents,
  fullName,
  initials,
  startOfWeek,
  todayIso,
} from '../format';
import { HOME_BY_ROLE } from '../roles';

describe('money formatting', () => {
  it('formats whole dollars and shows a dash for missing values', () => {
    expect(formatMoney('125000.40')).toBe('$125,000');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });

  it('formats cents', () => {
    expect(formatMoneyCents('42.5')).toBe('$42.50');
    expect(formatMoneyCents(null)).toBe('—');
    expect(formatMoneyCents(undefined)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats an ISO calendar day without timezone shifting', () => {
    expect(formatDate('2030-06-12')).toBe('Jun 12, 2030');
    expect(formatDate('2030-01-01')).toBe('Jan 1, 2030');
  });

  it('shows the UTC calendar day of a timestamp, whatever its offset', () => {
    expect(formatDate('2030-06-11T20:00:00-04:00')).toBe('Jun 12, 2030');
    expect(formatDate('2030-06-12T23:30:00Z')).toBe('Jun 12, 2030');
    expect(formatDate('2030-06-12T23:30:00')).toBe('Jun 12, 2030');
    expect(formatDate('2030-06-13T01:00:00+0200')).toBe('Jun 12, 2030');
  });

  it('shows a dash for empty values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('formats timestamps with and without an offset as the same instant', () => {
    const withZ = formatDateTime('2030-06-12T15:45:00Z');
    expect(withZ).toMatch(/2030/);
    expect(withZ).toMatch(/\d{1,2}:45/);
    expect(formatDateTime('2030-06-12T15:45:00')).toBe(withZ);
    expect(formatDateTime('2030-06-12T11:45:00-04:00')).toBe(withZ);
  });

  it('shows a dash for empty values', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });
});

describe('names', () => {
  it('builds full names and initials', () => {
    const person = { first_name: 'Ada', last_name: 'lovelace' };
    expect(fullName(person)).toBe('Ada lovelace');
    expect(initials(person)).toBe('AL');
  });

  it('handles missing people and empty name parts', () => {
    expect(fullName(null)).toBe('—');
    expect(initials(undefined)).toBe('?');
    expect(initials({ first_name: '', last_name: '' })).toBe('');
  });

  it('capitalizes text', () => {
    expect(capitalize('manager')).toBe('Manager');
    expect(capitalize('')).toBe('');
    expect(capitalize(undefined)).toBe('');
  });
});

describe('date helpers', () => {
  afterEach(() => jest.useRealTimers());

  it('returns today in UTC', () => {
    jest.useFakeTimers({ now: new Date('2030-06-12T23:59:00Z') });
    expect(todayIso()).toBe('2030-06-12');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2030-06-30', 1)).toBe('2030-07-01');
    expect(addDays('2030-01-01', -1)).toBe('2029-12-31');
  });

  it('finds the Monday of the week (Sunday belongs to the previous week)', () => {
    expect(startOfWeek('2030-06-12')).toBe('2030-06-10'); // Wednesday
    expect(startOfWeek('2030-06-10')).toBe('2030-06-10'); // Monday
    expect(startOfWeek('2030-06-16')).toBe('2030-06-10'); // Sunday
  });

  it('counts whole days between ISO dates', () => {
    expect(daysBetween('2030-06-01', '2030-06-12')).toBe(11);
    expect(daysBetween('2030-06-12', '2030-06-01')).toBe(-11);
    expect(daysBetween('2030-03-01', '2030-03-31')).toBe(30);
  });
});

describe('coversDay', () => {
  const assignment = { state: 'active', start_date: '2030-06-10', effective_end_date: '2030-06-14' };

  it('includes both ends of the period', () => {
    expect(coversDay(assignment, '2030-06-10')).toBe(true);
    expect(coversDay(assignment, '2030-06-14')).toBe(true);
    expect(coversDay(assignment, '2030-06-09')).toBe(false);
    expect(coversDay(assignment, '2030-06-15')).toBe(false);
  });

  it('ignores cancelled assignments', () => {
    expect(coversDay({ ...assignment, state: 'cancelled' }, '2030-06-12')).toBe(false);
  });
});

describe('assignmentDisplayState', () => {
  const base = { planned_end_date: '2030-06-30', effective_end_date: '2030-06-30', ended_at: null };

  it('passes through states other than an early completion', () => {
    expect(assignmentDisplayState({ ...base, state: 'active' })).toBe('active');
    expect(assignmentDisplayState({ ...base, state: 'completed' })).toBe('completed');
    expect(
      assignmentDisplayState({ ...base, state: 'completed', ended_at: '2030-06-30T10:00:00Z' }),
    ).toBe('completed');
  });

  it('explains work cut short by a removal or a cancelled milestone', () => {
    const early = { ...base, state: 'completed', ended_at: '2030-06-20T10:00:00Z', effective_end_date: '2030-06-20' };
    expect(assignmentDisplayState(early, 'pending')).toBe('removed_early');
    expect(assignmentDisplayState(early, 'cancelled')).toBe('milestone_cancelled');
  });
});

describe('HOME_BY_ROLE', () => {
  it('maps each role to its dashboard', () => {
    expect(HOME_BY_ROLE).toEqual({ admin: '/admin', manager: '/manager', employee: '/employee' });
  });
});
