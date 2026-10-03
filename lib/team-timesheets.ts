import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { csvCell } from './csv';
import { supportedTimeClockZone } from './time-clock';
import type { TeamTimesheetData, TeamTimesheetQuery } from './team-timesheet-types';

const date = z.iso.date().refine(value => !value.startsWith('0000-'));
const version = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(value => BigInt(value) <= 9223372036854775807n);
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().refine(Number.isSafeInteger);
const seconds = z.number().finite().nonnegative().refine(value => value <= Number.MAX_SAFE_INTEGER);
const filters = z.object({ startDate: date, endDate: date, agentId: z.uuid().nullable() }).strict();
const cursor = z.object({ tenantId: z.uuid(), actorId: z.uuid(), startDate: date, endDate: date, agentId: z.uuid().nullable(),
  timeZone: z.string().min(1).max(100), datasetVersion: version, startedAt: instant, entryId: z.uuid() }).strict();
const responseSchema = z.object({
  company: z.object({ id: z.uuid(), name: z.string(), time_zone: z.string().refine(supportedTimeClockZone) }),
  role: z.enum(['owner', 'admin']), actorId: z.uuid(), filters, timeZone: z.string().refine(supportedTimeClockZone),
  serverTime: instant, datasetVersion: version,
  summary: z.object({ entryCount: count, agentCount: count, elapsedSeconds: seconds, unpaidBreakSeconds: seconds, paidSeconds: seconds }).strict(),
  agents: z.array(z.object({ id: z.uuid(), name: z.string() })),
  entries: z.array(z.object({ id: z.uuid(), tenant_id: z.uuid(), agent_id: z.uuid(), agent_name: z.string(), job_id: z.uuid(), job_name: z.string(),
    started_at: instant, ended_at: instant, revision: z.number().int().positive(), elapsed_seconds: seconds, unpaid_break_seconds: seconds, paid_seconds: seconds })),
  nextCursor: cursor.nullable(), exportLimit: z.literal(10000),
});
export class TeamTimesheetError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
export function parseTeamTimesheetQuery(params: URLSearchParams): TeamTimesheetQuery {
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new TeamTimesheetError('Choose valid timesheet filters.', 400);
  const parsed = z.object({ tenantId: z.uuid(), startDate: date, endDate: date, agentId: z.uuid().optional(),
    mode: z.enum(['review', 'export']).optional(), limit: z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(value => value <= 100).optional(),
    cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).max(1400).optional() }).strict().safeParse(Object.fromEntries(params));
  if (!parsed.success || parsed.data.startDate > parsed.data.endDate ||
    parsed.data.mode === 'export' && (parsed.data.cursor || parsed.data.limit !== undefined)) throw new TeamTimesheetError('Choose valid timesheet dates and filters.', 400);
  return { ...parsed.data, agentId: parsed.data.agentId ?? null, mode: parsed.data.mode ?? 'review', limit: parsed.data.limit ?? 50 };
}
export function decodeTeamTimesheetCursor(value?: string) {
  if (!value) return null;
  try {
    if (value.length > 1400 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    return cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch { throw new TeamTimesheetError('Choose a valid timesheet cursor.', 400); }
}
async function access(client: SupabaseClient, tenantId: string, userId?: string) {
  if (!userId) {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) throw new TeamTimesheetError('Sign in to continue.', 401);
    userId = user.id;
  }
  const [member, company] = await Promise.all([
    client.from('tenant_memberships').select('role').eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 'active').maybeSingle(),
    client.from('tenants').select('id,name,time_zone,status').eq('id', tenantId).eq('status', 'active').maybeSingle(),
  ]);
  if (member.error || company.error) throw new TeamTimesheetError('Company access could not be checked.');
  if (!member.data || !company.data || !['owner', 'admin'].includes(member.data.role)) throw new TeamTimesheetError('Only owners and admins can review team timesheets.', 403);
  if (!supportedTimeClockZone(company.data.time_zone)) throw new TeamTimesheetError('Company time zone could not be read.');
  return { userId, role: member.data.role as 'owner' | 'admin', company: company.data };
}
function databaseError(code: string) {
  if (code === '42501') return new TeamTimesheetError('Your company access changed. Team timesheets are unavailable.', 403);
  if (code === '40001') return new TeamTimesheetError('Completed timesheets changed. Refresh the review before loading more.', 409);
  if (code === '54000') return new TeamTimesheetError('Export exceeds 10,000 completed records. Narrow the dates or user filter.', 413);
  if (['22023', '22P02', '22007', '22008'].includes(code)) return new TeamTimesheetError('Timesheet filters changed or are invalid. Refresh the review.', 400);
  return new TeamTimesheetError('Team timesheets could not be loaded. Try refreshing the review.');
}
export async function readTeamTimesheets(client: SupabaseClient, query: TeamTimesheetQuery): Promise<TeamTimesheetData> {
  const current = await access(client, query.tenantId);
  const { data, error } = await client.rpc('read_team_timesheets', { target_tenant: query.tenantId, start_date: query.startDate, end_date: query.endDate,
    target_agent: query.agentId, page_limit: query.limit, after_entry: decodeTeamTimesheetCursor(query.cursor), export_all: query.mode === 'export' });
  if (error) throw databaseError(error.code);
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new TeamTimesheetError('Team timesheet response could not be verified.');
  const result = parsed.data;
  if (result.actorId !== current.userId || result.company.id !== query.tenantId || result.role !== current.role || result.timeZone !== current.company.time_zone ||
    result.company.time_zone !== result.timeZone || result.filters.startDate !== query.startDate || result.filters.endDate !== query.endDate || result.filters.agentId !== query.agentId ||
    result.entries.length > (query.mode === 'export' ? 10000 : query.limit) || result.summary.entryCount < result.entries.length || result.summary.agentCount > result.summary.entryCount ||
    result.entries.some(entry => entry.tenant_id !== query.tenantId || query.agentId !== null && entry.agent_id !== query.agentId) ||
    new Set(result.entries.map(entry => entry.id)).size !== result.entries.length ||
    query.mode === 'export' && (result.nextCursor !== null || result.entries.length !== result.summary.entryCount || new Set(result.entries.map(entry => entry.agent_id)).size !== result.summary.agentCount)) throw new TeamTimesheetError('Incomplete or inconsistent team timesheet response refused.');
  if (result.nextCursor && (result.nextCursor.tenantId !== query.tenantId || result.nextCursor.actorId !== current.userId || result.nextCursor.timeZone !== result.timeZone ||
    result.nextCursor.startDate !== query.startDate || result.nextCursor.endDate !== query.endDate || result.nextCursor.agentId !== query.agentId || result.nextCursor.datasetVersion !== result.datasetVersion)) throw new TeamTimesheetError('Timesheet cursor scope could not be verified.');
  const latest = await access(client, query.tenantId, current.userId);
  if (latest.role !== current.role || latest.company.time_zone !== current.company.time_zone) throw new TeamTimesheetError('Company access changed. Refresh the review.', 403);
  return { ...result, company: { id: latest.company.id, name: latest.company.name, time_zone: latest.company.time_zone },
    nextCursor: result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString('base64url') : null };
}
export function teamTimesheetCSV(data: TeamTimesheetData) {
  if (data.nextCursor !== null || data.entries.length !== data.summary.entryCount || data.entries.length > 10000) throw new TeamTimesheetError('Incomplete timesheet export refused.');
  const headers = ['User', 'User ID', 'Job', 'Clock in timestamp', 'Clock out timestamp', 'Company time zone', 'Elapsed seconds', 'Unpaid break seconds', 'Tracked seconds'];
  const rows = data.entries.map(entry => [entry.agent_name, entry.agent_id, entry.job_name, entry.started_at, entry.ended_at, data.timeZone,
    String(entry.elapsed_seconds), String(entry.unpaid_break_seconds), String(entry.paid_seconds)]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Validate and encode the entire bounded snapshot before exposing a download.
// Pull-based chunks preserve UTF-8 bytes and use Vercel's streaming response path.
export function teamTimesheetCSVStream(data: TeamTimesheetData): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(teamTimesheetCSV(data));
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end)); offset = end;
    },
    cancel() { offset = bytes.length; },
  });
}
