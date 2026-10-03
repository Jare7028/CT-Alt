import test from "node:test";
import assert from "node:assert/strict";
import {
  zonedInstant,
  clippedHours,
  viewDays,
  localDateTime,
  dayBoundary,
} from "../../lib/rota-time.ts";
test("DST gap is rejected; ambiguous times require explicit occurrence", () => {
  assert.throws(
    () => zonedInstant("2026-03-29T01:30", "Europe/London"),
    /does not exist/,
  );
  assert.throws(
    () => zonedInstant("2026-10-25T01:30", "Europe/London"),
    /occurs twice/,
  );
  assert.equal(
    zonedInstant("2026-10-25T01:30", "Europe/London", "earlier"),
    "2026-10-25T00:30:00.000Z",
  );
  assert.equal(
    zonedInstant("2026-10-25T01:30", "Europe/London", "later"),
    "2026-10-25T01:30:00.000Z",
  );
  assert.equal(
    zonedInstant("2026-04-05T01:45", "Australia/Lord_Howe", "later"),
    "2026-04-04T15:15:00.000Z",
  );
});
test("overnight totals split at local midnight and count real elapsed hours", () => {
  assert.equal(
    clippedHours(
      "2026-10-24T22:00:00Z",
      "2026-10-25T07:00:00Z",
      "2026-10-24",
      "Europe/London",
    ),
    1,
  );
  assert.equal(
    clippedHours(
      "2026-10-24T22:00:00Z",
      "2026-10-25T07:00:00Z",
      "2026-10-25",
      "Europe/London",
    ),
    8,
  );
  assert.equal(
    clippedHours(
      "2026-03-29T00:00:00Z",
      "2026-03-29T03:00:00Z",
      "2026-03-29",
      "Europe/London",
    ),
    3,
  );
  assert.equal(
    (dayBoundary("2026-10-26", "Europe/London") -
      dayBoundary("2026-10-25", "Europe/London")) /
      3600000,
    25,
  );
  assert.equal(
    (dayBoundary("2026-03-30", "Europe/London") -
      dayBoundary("2026-03-29", "Europe/London")) /
      3600000,
    23,
  );
});
test("midnight transitions and skipped calendar dates do not crash totals", () => {
  assert.equal(
    localDateTime(
      new Date(dayBoundary("2026-09-06", "America/Santiago")).toISOString(),
      "America/Santiago",
    ),
    "2026-09-06T01:00",
  );
  assert.equal(
    dayBoundary("2011-12-30", "Pacific/Apia"),
    dayBoundary("2011-12-31", "Pacific/Apia"),
  );
});
test("conversion ignores machine timezone and supports fractional offsets", () => {
  assert.equal(
    zonedInstant("2026-10-03T09:00", "Asia/Kathmandu"),
    "2026-10-03T03:15:00.000Z",
  );
  assert.equal(
    localDateTime("2026-10-03T03:15:00Z", "Asia/Kathmandu"),
    "2026-10-03T09:00",
  );
  assert.throws(
    () => zonedInstant("2026-02-30T09:00", "UTC"),
    /valid calendar/,
  );
});
test("calendar periods use Monday weeks and true month lengths", () => {
  assert.deepEqual(viewDays("2026-10-04", "Week"), [
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
  assert.equal(viewDays("2028-02-29", "Month").length, 29);
  assert.equal(viewDays("2026-02-28", "Month").length, 28);
});
