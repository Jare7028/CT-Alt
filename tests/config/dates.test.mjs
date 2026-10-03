import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEmploymentDate, formatTimestamp, compareDateValues } from '../../lib/agent-dates.ts';
test('calendar-only employment date never shifts with a company time zone',()=>{
 assert.equal(formatEmploymentDate('2026-10-03'),'3 Oct 2026');
 assert.equal(formatEmploymentDate('2024-02-29'),'29 Feb 2024');
 assert.equal(formatEmploymentDate(null),'—');
 for(const value of ['infinity','-infinity','2026-02-30','10000-01-01','0000-01-01'])assert.equal(formatEmploymentDate(value),'Invalid date');
 assert.equal(formatTimestamp('2026-10-03T12:00:00Z','Pacific/Auckland'),'4 Oct 2026');
 assert.equal(formatTimestamp('2026-10-03T12:00:00Z','America/Los_Angeles'),'3 Oct 2026');
});
test('raw dates and timestamp instants sort chronologically, not by displayed month/day',()=>{
 const dates=['2026-10-03','2025-12-31','2026-02-01',null];
 assert.deepEqual(dates.sort((a,b)=>compareDateValues(a,b)),[null,'2025-12-31','2026-02-01','2026-10-03']);
 assert.ok(compareDateValues('2026-10-03T01:00:00+14:00','2026-10-02T12:00:00Z',true)<0);
});
