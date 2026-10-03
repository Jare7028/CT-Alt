import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Company, Member } from './agent-types';
import type { ActivityData, ActivityEvent, ActivityFilters, OverviewData } from './overview-types';

const roles = ['owner', 'admin', 'manager', 'employee'] as const;
const actions = ['created', 'updated', 'archived', 'restored'] as const;
const uuid = z.uuid();
const date = z.iso.date().refine(value => !value.startsWith('0000-'));
const auditId = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => BigInt(value) <= 9223372036854775807n);
const cursorSchema = z.object({
  v: z.literal(1), tenantId: uuid, timeZone: z.string().min(1).max(100),
  action: z.enum(actions).nullable(), startDate: date.nullable(), endDate: date.nullable(),
  at: z.iso.datetime({ offset: true }), id: auditId,
}).strict();
export class OverviewReadError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
function invalid(message = 'Choose valid activity filters.'): never { throw new OverviewReadError(message, 400); }
export function parseOverviewQuery(params: URLSearchParams) {
  if ([...params.keys()].some(key => key !== 'tenantId') || params.getAll('tenantId').length !== 1) invalid('Choose a company.');
  const parsed = uuid.safeParse(params.get('tenantId'));
  if (!parsed.success) invalid('Choose a company.');
  return parsed.data;
}
export function parseActivityQuery(params: URLSearchParams): { tenantId: string; filters: ActivityFilters } {
  const allowed = ['tenantId', 'action', 'startDate', 'endDate', 'cursor', 'limit'];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) invalid();
  const parsed = z.object({
    tenantId: uuid, action: z.enum(actions).optional(), startDate: date.optional(), endDate: date.optional(),
    cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).max(700).optional(),
    limit: z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(value => value <= 100).optional(),
  }).safeParse(Object.fromEntries(params));
  if (!parsed.success) invalid();
  const { tenantId, ...filters } = parsed.data;
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) invalid('Start date must be before or on the end date.');
  return { tenantId, filters: { ...filters, limit: filters.limit ?? 50 } };
}
// Find the first instant of a company's calendar date. Searching the date,
// rather than assuming midnight exists, handles DST and skipped local dates.
export function companyDateBoundary(value: string, timeZone: string, followingDay = false) {
  if (!date.safeParse(value).success) invalid();
  const utc = new Date(value + 'T00:00:00Z');
  if (followingDay) utc.setUTCDate(utc.getUTCDate() + 1);
  const target = utc.getUTCFullYear() * 10000 + (utc.getUTCMonth() + 1) * 100 + utc.getUTCDate();
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', era: 'short' }); }
  catch { throw new OverviewReadError('Company time zone could not be read.'); }
  const day = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
    return year * 10000 + Number(parts.month) * 100 + Number(parts.day);
  };
  let low = utc.valueOf() - 3 * 86400000, high = utc.valueOf() + 3 * 86400000;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (day(middle) < target) low = middle + 1; else high = middle; }
  return new Date(low).toISOString();
}
type Access = { company: Company & { status: 'active' }; role: Member['role']; userId: string };
async function access(client: SupabaseClient, tenantId: string, userId?: string): Promise<Access> {
  if (!uuid.safeParse(tenantId).success) invalid('Choose a company.');
  if (!userId) {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) throw new OverviewReadError('Sign in to continue.', 401);
    userId = user.id;
  }
  const [member, company] = await Promise.all([
    client.from('tenant_memberships').select('role').eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 'active').maybeSingle(),
    client.from('tenants').select('id,name,time_zone,status').eq('id', tenantId).eq('status', 'active').maybeSingle(),
  ]);
  if (member.error || company.error) throw new OverviewReadError('Company access could not be checked.');
  if (!member.data || !company.data || !roles.includes(member.data.role) || member.data.role === 'employee') throw new OverviewReadError('You do not have permission to view this company overview.', 403);
  try { new Intl.DateTimeFormat('en-GB', { timeZone: company.data.time_zone }).format(); }
  catch { throw new OverviewReadError('Company time zone could not be read.'); }
  return { company: company.data, role: member.data.role, userId };
}
async function recheck(client: SupabaseClient, before: Access) {
  const after = await access(client, before.company.id, before.userId);
  if (after.role !== before.role || after.company.time_zone !== before.company.time_zone) throw new OverviewReadError('Company access changed. Reload to continue.', 403);
  return after;
}
function canViewActivity(role: Member['role']) { return role === 'owner' || role === 'admin'; }
export async function readDashboardAccess(client: SupabaseClient, tenantId: string) {
  const current = await access(client, tenantId);
  return { company: current.company, role: current.role };
}
function cursorScope(tenantId: string, timeZone: string, filters: ActivityFilters) {
  return { v: 1 as const, tenantId, timeZone, action: filters.action ?? null, startDate: filters.startDate ?? null, endDate: filters.endDate ?? null };
}
export function activityCursor(tenantId: string, timeZone: string, filters: ActivityFilters, last: Pick<ActivityEvent, 'id' | 'occurred_at'>) {
  const data = cursorSchema.parse({ ...cursorScope(tenantId, timeZone, filters), at: last.occurred_at, id: last.id });
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}
export function activityCursorFilter(tenantId: string, timeZone: string, filters: ActivityFilters) {
  if (!filters.cursor) return null;
  let raw: unknown;
  try { if (filters.cursor.length > 700 || !/^[A-Za-z0-9_-]+$/.test(filters.cursor)) invalid(); raw = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString('utf8')); } catch { invalid('Choose a valid activity cursor.'); }
  const parsed = cursorSchema.safeParse(raw);
  if (!parsed.success) invalid('Choose a valid activity cursor.');
  const scope = cursorScope(tenantId, timeZone, filters);
  if (Object.entries(scope).some(([key, value]) => parsed.data[key as keyof typeof parsed.data] !== value)) invalid('Activity filters changed. Start from the latest events.');
  // Only validated ISO timestamps and positive bigint digits reach PostgREST's
  // filter grammar. Preserve microseconds, which Date.toISOString would lose.
  return `occurred_at.lt.${parsed.data.at},and(occurred_at.eq.${parsed.data.at},id.lt.${parsed.data.id})`;
}
async function activityRows(client: SupabaseClient, current: Access, filters: ActivityFilters): Promise<ActivityData> {
  let query = client.from('agent_audit').select('id::text,agent_id,actor_user_id,actor_name,action,revision,occurred_at').eq('tenant_id', current.company.id)
    .order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(filters.limit + 1);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.startDate) query = query.gte('occurred_at', companyDateBoundary(filters.startDate, current.company.time_zone));
  if (filters.endDate) query = query.lt('occurred_at', companyDateBoundary(filters.endDate, current.company.time_zone, true));
  const cursor = activityCursorFilter(current.company.id, current.company.time_zone, filters);
  if (cursor) query = query.or(cursor);
  const { data, error } = await query;
  if (error || !data) throw new OverviewReadError('Activity could not be loaded.');
  const rows = data.slice(0, filters.limit);
  const agentIds = [...new Set(rows.map(row => row.agent_id))];
  const names = new Map<string, string>();
  if (agentIds.length) {
    const agents = await client.from('agents').select('id,first_name,last_name').eq('tenant_id', current.company.id).in('id', agentIds);
    if (agents.error || !agents.data) throw new OverviewReadError('Activity names could not be loaded.');
    for (const agent of agents.data) names.set(agent.id, `${agent.first_name} ${agent.last_name}`);
  }
  const events: ActivityEvent[] = rows.map(row => ({ id: String(row.id), agent_id: row.agent_id, agent_name: names.get(row.agent_id) ?? row.agent_id,
    actor_user_id: row.actor_user_id, actor_name: row.actor_name, action: row.action, revision: row.revision, occurred_at: row.occurred_at }));
  return { events, timeZone: current.company.time_zone, nextCursor: data.length > filters.limit && events.length ? activityCursor(current.company.id, current.company.time_zone, filters, events[events.length - 1]) : null };
}
export async function readActivity(client: SupabaseClient, tenantId: string, filters: ActivityFilters): Promise<ActivityData> {
  const current = await access(client, tenantId);
  if (!canViewActivity(current.role)) throw new OverviewReadError('Only owners and admins can view activity.', 403);
  const result = await activityRows(client, current, filters);
  await recheck(client, current);
  return result;
}
export async function readOverview(client: SupabaseClient, tenantId: string): Promise<OverviewData> {
  const current = await access(client, tenantId);
  const agentCount = (status: string) => client.from('agents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', status);
  const results = await Promise.all([
    agentCount('active'), agentCount('archived'), agentCount('active').not('user_id', 'is', null), agentCount('active').is('user_id', null),
    ...roles.map(role => client.from('tenant_memberships').select('user_id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active').eq('role', role)),
  ]);
  if (results.some(result => result.error || !Number.isSafeInteger(result.count) || result.count! < 0)) throw new OverviewReadError('Overview counts could not be loaded.');
  const counts = results.map(result => result.count!);
  const recent = canViewActivity(current.role) ? (await activityRows(client, current, { limit: 6 })).events : [];
  const latest = await recheck(client, current);
  return { company: latest.company, role: latest.role, canViewActivity: canViewActivity(latest.role), agents: { active: counts[0], archived: counts[1], linked: counts[2], unlinked: counts[3] },
    memberships: { owner: counts[4], admin: counts[5], manager: counts[6], employee: counts[7] }, recentActivity: recent };
}
