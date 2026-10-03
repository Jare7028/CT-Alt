import type { Company, Member } from './agent-types';
export type TimeClockJob = { id: string; name: string; status: 'active' | 'archived'; revision: number };
export type TimeClockBreak = { id: string; paid: boolean; started_at: string; ended_at: string | null };
export type TimeClockEntry = {
  id: string; tenant_id: string; agent_id: string; agent_name: string; job_id: string; job_name: string;
  started_at: string; ended_at: string | null; revision: number; breaks: TimeClockBreak[];
  elapsed_seconds: number; unpaid_break_seconds: number; paid_seconds: number;
};
export type TimeClockData = {
  company: Company; role: Member['role']; actorId: string; agent: { id: string; name: string } | null;
  jobs: TimeClockJob[]; entry: TimeClockEntry | null; serverTime: string; canManageJobs: boolean; canViewAttendance: boolean;
};
export type TimeClockEntriesData = { entries: TimeClockEntry[]; nextCursor: string | null; serverTime: string; timeZone: string };
export type TimeClockChange =
  | { action: 'create_job'; name: string }
  | { action: 'archive_job'; jobId: string; revision: number }
  | { action: 'clock_in'; jobId: string }
  | { action: 'break_start'; entryId: string; revision: number; paid: boolean }
  | { action: 'break_end' | 'clock_out'; entryId: string; revision: number };
export type TimeClockSaved = { operationId: string; action: TimeClockChange['action']; jobId: string; entryId?: string; revision: number };
export type TimeClockQuery = { tenantId: string; mode: 'status' | 'attendance' | 'timesheets'; limit: number; startDate?: string; endDate?: string; cursor?: string };
