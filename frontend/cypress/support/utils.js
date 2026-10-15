/** Date and formatting helpers that mirror the app (all calendar days are UTC). */

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Short, unique-per-run suffix so specs never collide with earlier runs' data. */
export const uniqueId = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toLowerCase();

/** "2030-06-12" -> "Jun 12, 2030" (same as the app's formatDate). */
export const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

/** Same as the app's formatMoneyCents. */
export const formatMoneyCents = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));

/** Monday-Friday days in [start, end] as ISO strings. */
export function weekdaysBetween(start, end) {
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(day);
  }
  return days;
}
