// Employment dates are calendar values, not instants in a company time zone.
export function formatEmploymentDate(value: string | null) {
  if (!value) return '—';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return 'Invalid date';
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return 'Invalid date';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium' }).format(date);
}
export function formatTimestamp(value: string, timeZone: string) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium' }).format(date) : 'Invalid date';
}
export function compareDateValues(left: string | null, right: string | null, timestamp = false) {
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);
  return timestamp ? new Date(left).valueOf() - new Date(right).valueOf() : left.localeCompare(right);
}
