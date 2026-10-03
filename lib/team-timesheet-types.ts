import type { Company } from './agent-types';
import type { TimeClockEntry } from './time-clock-types';
export type TeamTimesheetEntry = Omit<TimeClockEntry, 'breaks'> & { ended_at: string };
export type TeamTimesheetFilters = { startDate: string; endDate: string; agentId: string | null };
export type TeamTimesheetData = {
  company: Company; role: 'owner' | 'admin'; actorId: string; filters: TeamTimesheetFilters;
  timeZone: string; serverTime: string; datasetVersion: string;
  summary: { entryCount: number; agentCount: number; elapsedSeconds: number; unpaidBreakSeconds: number; paidSeconds: number };
  agents: { id: string; name: string }[]; entries: TeamTimesheetEntry[]; nextCursor: string | null; exportLimit: number;
};
export type TeamTimesheetQuery = TeamTimesheetFilters & { tenantId: string; mode: 'review' | 'export'; limit: number; cursor?: string };
