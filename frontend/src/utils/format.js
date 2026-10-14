/** Small formatting and date helpers shared by pages. All dates are UTC calendar days. */

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const currencyCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatMoney = (value) =>
  value === null || value === undefined ? '—' : currency.format(Number(value));
export const formatMoneyCents = (value) =>
  value === null || value === undefined ? '—' : currencyCents.format(Number(value));

/** Format "2030-06-12" as "Jun 12, 2030" without timezone shifting. */
export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const fullName = (person) => (person ? `${person.first_name} ${person.last_name}` : '—');
export const initials = (person) =>
  person ? `${person.first_name[0] || ''}${person.last_name[0] || ''}`.toUpperCase() : '?';

/** Today's date as YYYY-MM-DD in UTC (matches the backend's date boundaries). */
export const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday of the week containing the given ISO date. */
export function startOfWeek(iso) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, day === 0 ? -6 : 1 - day);
}

/** True when the assignment covers the ISO day (inclusive) and was not cancelled. */
export const coversDay = (assignment, day) =>
  assignment.state !== 'cancelled' &&
  assignment.start_date <= day &&
  day <= assignment.effective_end_date;

export const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');

/** Whole days from a to b (ISO dates). */
export const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
