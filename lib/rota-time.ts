// Convert calendar input in the schedule's IANA zone without using the browser
// zone. Enumerate possible offsets; reject gaps and require overlap choice.
export function localDateTime(instant: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function zonedInstant(
  local: string,
  zone: string,
  occurrence: "" | "earlier" | "later" = "",
) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Enter a date and time.");
  const wall = Date.parse(local + "Z");
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== local
  )
    throw new Error("Enter a valid calendar date.");
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const stamp = wall + hours * 3600000;
    offsets.add(
      Date.parse(localDateTime(new Date(stamp).toISOString(), zone) + "Z") -
        stamp,
    );
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter(
      (stamp) => localDateTime(new Date(stamp).toISOString(), zone) === local,
    )
    .sort((a, b) => a - b);
  if (!matches.length)
    throw new Error(
      "This time does not exist because the clocks change. Choose another time.",
    );
  if (matches.length > 1 && !occurrence)
    throw new Error(
      "This time occurs twice because the clocks change. Choose the earlier or later occurrence.",
    );
  return new Date(
    occurrence === "later" ? matches.at(-1)! : matches[0],
  ).toISOString();
}
export function dateInZone(instant: string, zone: string) {
  return localDateTime(instant, zone).slice(0, 10);
}
export function addDays(day: string, count: number) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function viewDays(day: string, view: "Day" | "Week" | "Month") {
  const date = new Date(day + "T12:00:00Z");
  const start =
    view === "Week"
      ? addDays(day, -((date.getUTCDay() + 6) % 7))
      : view === "Month"
        ? day.slice(0, 8) + "01"
        : day;
  const count =
    view === "Week"
      ? 7
      : view === "Month"
        ? new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
          ).getUTCDate()
        : 1;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
// First instant on or after a calendar day. A binary search also handles
// zones whose spring transition skips midnight (and entirely skipped dates).
export function dayBoundary(day: string, zone: string) {
  const wall = Date.parse(day + "T00:00:00Z");
  let lo = wall - 36 * 3600000;
  let hi = wall + 36 * 3600000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (dateInZone(new Date(mid).toISOString(), zone) < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function clippedHours(
  starts: string,
  ends: string,
  day: string,
  zone: string,
) {
  return (
    Math.max(
      0,
      Math.min(Date.parse(ends), dayBoundary(addDays(day, 1), zone)) -
        Math.max(Date.parse(starts), dayBoundary(day, zone)),
    ) / 3600000
  );
}
