import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type * as R from './requests-types';
import { REQUESTS_LIMITS as L } from './requests-types';
import { formsStringValid, formsSemanticJSON, formsParseJSON, FormsError } from './forms';
export class RequestsError extends Error {
    status: number;
    constructor(message: string, status = 503) { super(message); this.status = status; }
}
function invalid(): never { throw new RequestsError('Requests could not be verified. Refresh and review.'); }
const bytes = (v: string) => Buffer.byteLength(v, 'utf8');
const uuid = z.uuid().transform(v => v.toLowerCase()), role = z.enum(['owner', 'admin', 'manager', 'employee']);
const text = (n: number) => z.string().refine(v => v.length <= n && formsStringValid(v));
const status = z.enum(['new', 'in_progress', 'done']), action = z.enum(['create', 'edit', 'move']);
const revision = z.number().int().min(1).max(2147483647), count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[0-9a-f]{32}$/);
function civilValid(v: string) { if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) || v.slice(0, 4) === '0000')
    return false; const d = new Date(v + 'T00:00:00.000Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; }
const civil = z.string().refine(civilValid), time = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/).refine(v => civilValid(v.slice(0, 10)) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19));
const details = { title: text(L.title).refine(v => v.trim().length > 0), description: text(L.description), priority: z.enum(['low', 'normal', 'high']), dueDate: civil.nullable(), assigneeAgentId: uuid.nullable(), assigneeActorId: uuid.nullable() };
const changes = z.union([z.object({ action: z.literal('create'), ...details }).strict(), z.object({ action: z.literal('edit'), requestId: uuid, revision: revision.max(2147483646), ...details }).strict(), z.object({ action: z.literal('move'), requestId: uuid, revision: revision.max(2147483646), status }).strict()]).refine(v => v.action === 'move' || (v.assigneeAgentId === null) === (v.assigneeActorId === null));
export const requestsMutation: z.ZodType<R.RequestsMutation> = z.object({ tenantId: uuid, operationId: uuid, change: changes }).strict().refine(v => bytes(formsSemanticJSON(v)) <= L.requestBytes && bytes(JSON.stringify(v)) <= L.requestBytes);
export const requestsReconcileMutation: z.ZodType<R.RequestsReconcileQuery> = z.object({ mode: z.literal('reconcile'), tenantId: uuid, operationId: uuid, action }).strict();
const search = text(L.search), cursorText = z.string().min(1).max(6000).regex(/^[A-Za-z0-9_-]+$/), limit = z.coerce.number().int().min(1).max(L.pageMax);
const query = z.union([z.object({ tenantId: uuid, mode: z.literal('board').default('board'), search: search.default(''), limit: limit.default(L.pageDefault) }).strict(), z.object({ tenantId: uuid, mode: z.literal('column'), status, search: search.default(''), limit: limit.default(L.pageDefault), cursor: cursorText.optional() }).strict(), z.object({ tenantId: uuid, mode: z.literal('detail'), requestId: uuid }).strict(), z.object({ tenantId: uuid, mode: z.literal('assignees'), search: search.default(''), limit: limit.default(L.pageDefault), cursor: cursorText.optional() }).strict()]);
export function parseRequestsQuery(p: URLSearchParams): R.RequestsQuery { const seen = new Set<string>(); for (const [k] of p) {
    if (seen.has(k))
        throw new RequestsError('Duplicate Requests query.', 400);
    seen.add(k);
} const q = query.safeParse(Object.fromEntries(p)); if (!q.success)
    throw new RequestsError('Choose valid Requests filters.', 400); return q.data; }
export function requestsParseJSON(raw: string): unknown { if (bytes(raw) > L.requestBytes)
    throw new RequestsError('Request is too large.', 413); try {
    return formsParseJSON(raw);
}
catch (e) {
    throw new RequestsError(e instanceof FormsError ? e.message : 'Choose valid request details.', 400);
} }
export async function requestsReadBody(request: Request) { const length = request.headers.get('content-length'); if (length && (!/^[0-9]+$/.test(length) || Number(length) > L.requestBytes))
    throw new RequestsError('Request is too large.', 413); const reader = request.body?.getReader(); if (!reader)
    throw new RequestsError('Choose request details.', 400); const parts: Uint8Array[] = []; let size = 0; try {
    while (true) {
        const p = await reader.read();
        if (p.done)
            break;
        size += p.value.length;
        if (size > L.requestBytes) {
            await reader.cancel();
            throw new RequestsError('Request is too large.', 413);
        }
        parts.push(p.value);
    }
}
finally {
    reader.releaseLock();
} const raw = new Uint8Array(size); let at = 0; for (const p of parts) {
    raw.set(p, at);
    at += p.length;
} try {
    return requestsParseJSON(new TextDecoder('utf8', { fatal: true }).decode(raw));
}
catch (e) {
    if (e instanceof RequestsError)
        throw e;
    throw new RequestsError('Choose valid UTF8 request details.', 400);
} }
const company = z.object({ id: uuid, name: text(500), time_zone: text(100).refine(v => { try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
    }
    catch {
        return false;
    } }) }).strict();
const identity = { schemaVersion: z.literal(1), company, actorId: uuid, role, scopeVersion: digest };
const person = z.object({ actorId: uuid, name: text(500) }).strict();
const card = z.object({ id: uuid, tenantId: uuid, title: details.title, description: details.description, priority: details.priority, dueDate: civil.nullable(), status, revision, requester: person, assignee: person.extend({ agentId: uuid, eligible: z.boolean() }).nullable(), createdAt: time, updatedAt: time, canEdit: z.boolean(), canMove: z.boolean(), canAssign: z.boolean() }).strict();
const cursor = z.object({ v: z.literal(1), tenantId: uuid, actorId: uuid, role, mode: z.enum(['column', 'assignees']), status: status.nullable(), search, scopeVersion: digest, key: text(1000), id: uuid }).strict();
const page = z.object({ requests: z.array(card).max(L.pageMax), nextCursor: cursor.nullable() }).strict();
const counts = z.object({ new: count, in_progress: count, done: count, total: count }).strict().refine(c => c.total === c.new + c.in_progress + c.done);
const board = z.object({ ...identity, mode: z.literal('board'), search, counts, columns: z.object({ new: page, in_progress: page, done: page }).strict(), capabilities: z.object({ canCreate: z.boolean(), canManage: z.boolean() }).strict(), serverTime: time }).strict();
const column = z.object({ ...identity, mode: z.literal('column'), status, search, counts, requests: z.array(card).max(L.pageMax), nextCursor: cursor.nullable(), serverTime: time }).strict();
const detail = z.object({ ...identity, mode: z.literal('detail'), request: card, serverTime: time }).strict();
const assignees = z.object({ ...identity, mode: z.literal('assignees'), search, matchedCount: count, users: z.array(person.extend({ agentId: uuid })).max(L.pageMax), nextCursor: cursor.nullable(), serverTime: time }).strict();
const access = z.object({ ...identity, requestRevision: revision.nullable() }).strict();
const savedSchema = z.object({ schemaVersion: z.literal(1), tenantId: uuid, actorId: uuid, role, operationId: uuid, action, requestId: uuid, revision, status }).strict().refine(v => v.action !== 'create' || v.revision === 1 && v.status === 'new');
const reconciliation = z.object({ schemaVersion: z.literal(1), tenantId: uuid, actorId: uuid, role, operationId: uuid, action, status: z.enum(['recorded', 'not_recorded']), saved: savedSchema.nullable() }).strict().refine(v => (v.status === 'recorded') === (v.saved !== null));
function fail(e: {
    code?: string;
} | null) { if (!e)
    return; if (e.code === '42501')
    throw new RequestsError('Current access to Requests is unavailable.', 403); if (e.code === '40001' || e.code === '23505')
    throw new RequestsError('Requests changed. Refresh and review.', 409); if (e.code?.startsWith('22') || e.code === '23514')
    throw new RequestsError('Choose valid request details.', 400); throw new RequestsError('Requests could not be read or saved. Refresh and review.'); }
async function signed(c: SupabaseClient) { const { data, error } = await c.auth.getUser(); if (error || !data.user)
    throw new RequestsError('Sign in to use Requests.', 401); if (data.user.is_anonymous)
    throw new RequestsError('Current account cannot use Requests.', 403); return data.user.id.toLowerCase(); }
function decodeCursor(value: string) { try {
    const raw = Buffer.from(value, 'base64url');
    if (raw.toString('base64url') !== value)
        throw Error();
    const parsed = cursor.safeParse(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw)));
    if (!parsed.success)
        throw Error();
    if (parsed.data.mode === 'column' && !time.safeParse(parsed.data.key).success)
        throw Error();
    return parsed.data;
}
catch {
    throw new RequestsError('Choose a valid Requests page.', 400);
} }
const encode = (v: z.infer<typeof cursor> | null) => v ? Buffer.from(JSON.stringify(v)).toString('base64url') : null;
function cursorScope(v: z.infer<typeof cursor>, q: R.RequestsQuery, actor: string) { if (!('search' in q) || v.tenantId !== q.tenantId || v.actorId !== actor || v.search !== q.search || v.mode !== q.mode || v.status !== (q.mode === 'column' ? q.status : null))
    throw new RequestsError('This Requests page belongs to a different scope.', 409); }
function validateCard(v: z.infer<typeof card>, d: {
    actorId: string;
    role: R.RequestsIdentity['role'];
    company: {
        id: string;
    };
}) { if (v.tenantId !== d.company.id || v.updatedAt < v.createdAt)
    invalid(); const admin = ['owner', 'admin'].includes(d.role), assigned = v.assignee?.actorId === d.actorId && v.assignee.eligible === true, own = v.requester.actorId === d.actorId; if (!admin && !own && !assigned || v.canAssign !== admin || v.canEdit !== (admin || own && v.status === 'new' && v.assignee === null) || v.canMove !== (admin || assigned))
    invalid(); }
async function freshAccess(c: SupabaseClient, q: R.RequestsQuery, actor: string) { if (await signed(c) !== actor)
    throw new RequestsError('Current account changed.', 403); const { data, error } = await c.rpc('read_requests_access', { target_tenant: q.tenantId, read_mode: q.mode, detail_id: q.mode === 'detail' ? q.requestId : null, action_name: null }); fail(error); const p = access.safeParse(data); if (!p.success)
    invalid(); if (p.data.company.id !== q.tenantId || p.data.actorId !== actor)
    throw new RequestsError('Current Requests scope changed.', 403); return p.data; }
export async function readRequests(c: SupabaseClient, value: R.RequestsQuery): Promise<R.RequestsData> {
    const parsed = query.safeParse(value);
    if (!parsed.success)
        throw new RequestsError('Choose valid Requests filters.', 400);
    const q = parsed.data, actor = await signed(c);
    const after = 'cursor' in q && q.cursor ? decodeCursor(q.cursor) : null;
    if (after)
        cursorScope(after, q, actor);
    const { data, error } = await c.rpc('read_requests', { target_tenant: q.tenantId, read_mode: q.mode, search_text: 'search' in q ? q.search : '', page_limit: 'limit' in q ? q.limit : L.pageDefault, state_filter: q.mode === 'column' ? q.status : null, after_row: after, detail_id: q.mode === 'detail' ? q.requestId : null });
    fail(error);
    if (bytes(JSON.stringify(data)) > 4194304)
        throw new RequestsError('Requests response is too large. Reduce the page limit.', 413);
    const schema = q.mode === 'board' ? board : q.mode === 'column' ? column : q.mode === 'detail' ? detail : assignees, p = schema.safeParse(data);
    if (!p.success)
        invalid();
    const d = p.data;
    if (d.mode !== q.mode || d.company.id !== q.tenantId || d.actorId !== actor)
        throw new RequestsError('Current Requests scope changed.', 403);
    if (after && (after.scopeVersion !== d.scopeVersion || after.role !== d.role))
        throw new RequestsError('Requests page changed.', 409);
    if ('search' in d && (!('search' in q) || d.search !== q.search))
        invalid();
    function verifyPage(pg: z.infer<typeof page>, s: R.RequestStatus, total: number) { if (!('limit' in q) || pg.requests.length > q.limit || pg.requests.length > total || new Set(pg.requests.map(v => v.id)).size !== pg.requests.length)
        invalid(); for (let i = 0; i < pg.requests.length; i++) {
        const v = pg.requests[i];
        validateCard(v, d);
        if (v.status !== s || i > 0 && (v.createdAt > pg.requests[i - 1].createdAt || v.createdAt === pg.requests[i - 1].createdAt && v.id >= pg.requests[i - 1].id))
            invalid();
        if (after && (v.createdAt > after.key || v.createdAt === after.key && v.id >= after.id))
            invalid();
    } if (d.mode === 'board' && (pg.requests.length !== Math.min(q.limit, total) || (pg.nextCursor !== null) !== (total > q.limit)))
        invalid(); if (pg.nextCursor) {
        if (pg.nextCursor.tenantId !== q.tenantId || pg.nextCursor.actorId !== actor || pg.nextCursor.mode !== 'column' || pg.nextCursor.status !== s || pg.nextCursor.search !== ('search' in q ? q.search : ''))
            invalid();
        const last = pg.requests.at(-1);
        if (pg.nextCursor.role !== d.role || pg.nextCursor.scopeVersion !== d.scopeVersion || !last || pg.requests.length !== q.limit || pg.nextCursor.id !== last.id || pg.nextCursor.key !== last.createdAt)
            invalid();
    } }
    if (d.mode === 'board') {
        if (!d.capabilities.canCreate || d.capabilities.canManage !== ['owner', 'admin'].includes(d.role))
            invalid();
        for (const s of ['new', 'in_progress', 'done'] as const)
            verifyPage(d.columns[s], s, d.counts[s]);
    }
    else if (d.mode === 'column') {
        if (q.mode !== 'column' || d.status !== q.status)
            invalid();
        verifyPage(d, d.status, d.counts[d.status]);
    }
    else if (d.mode === 'detail') {
        if (q.mode !== 'detail' || d.request.id !== q.requestId)
            invalid();
        validateCard(d.request, d);
    }
    else {
        if (!['owner', 'admin'].includes(d.role) || !('limit' in q) || d.users.length > q.limit || d.users.length > d.matchedCount || new Set(d.users.map(v => v.agentId)).size !== d.users.length)
            invalid();
        if (!after && (d.users.length !== Math.min(q.limit, d.matchedCount) || (d.nextCursor !== null) !== (d.matchedCount > q.limit)))
            invalid();
        if (d.nextCursor) {
            if (d.nextCursor.tenantId !== q.tenantId || d.nextCursor.actorId !== actor || d.nextCursor.mode !== 'assignees' || d.nextCursor.status !== null || d.nextCursor.search !== ('search' in q ? q.search : ''))
                invalid();
            if (d.nextCursor.scopeVersion !== d.scopeVersion || d.nextCursor.role !== d.role || d.users.length !== q.limit || d.nextCursor.id !== d.users.at(-1)?.agentId)
                invalid();
        }
    }
    const f = await freshAccess(c, q, actor);
    if (f.role !== d.role || f.company.name !== d.company.name || f.company.time_zone !== d.company.time_zone)
        throw new RequestsError('Current Requests scope changed.', 403);
    if (f.scopeVersion !== d.scopeVersion || d.mode === 'detail' && f.requestRevision !== d.request.revision)
        throw new RequestsError('Requests changed. Refresh and review.', 409);
    if (d.mode === 'board')
        return { ...d, columns: { new: { ...d.columns.new, nextCursor: encode(d.columns.new.nextCursor) }, in_progress: { ...d.columns.in_progress, nextCursor: encode(d.columns.in_progress.nextCursor) }, done: { ...d.columns.done, nextCursor: encode(d.columns.done.nextCursor) } } };
    if (d.mode === 'detail')
        return d;
    return { ...d, nextCursor: encode(d.nextCursor) };
}
export async function saveRequest(c: SupabaseClient, value: R.RequestsMutation): Promise<R.RequestsSaved> { const p = requestsMutation.safeParse(value); if (!p.success)
    throw new RequestsError('Choose valid request details.', 400); const v = p.data, actor = await signed(c); const { data, error } = await c.rpc('save_request', { target_tenant: v.tenantId, operation_id: v.operationId, change_text: JSON.stringify(v.change) }); fail(error); const parsed = savedSchema.safeParse(data); if (!parsed.success)
    invalid(); const s = parsed.data; if (s.tenantId !== v.tenantId || s.actorId !== actor || s.operationId !== v.operationId || s.action !== v.change.action || 'requestId' in v.change && s.requestId !== v.change.requestId || s.revision !== (v.change.action === 'create' ? 1 : v.change.revision + 1) || v.change.action === 'move' && s.status !== v.change.status)
    invalid(); if (await signed(c) !== actor)
    throw new RequestsError('Current account changed.', 403); const { data: f, error: e } = await c.rpc('read_requests_access', { target_tenant: v.tenantId, read_mode: 'detail', detail_id: s.requestId, action_name: s.action }); fail(e); const a = access.safeParse(f); if (!a.success)
    invalid(); if (a.data.actorId !== actor || a.data.company.id !== v.tenantId || a.data.role !== s.role)
    throw new RequestsError('Current Requests scope changed.', 403); return s; }
export async function reconcileRequest(c: SupabaseClient, value: R.RequestsReconcileQuery): Promise<R.RequestsReconciliation> { const p = requestsReconcileMutation.safeParse(value); if (!p.success)
    throw new RequestsError('Choose a valid recovery operation.', 400); const q = p.data, actor = await signed(c); async function fresh() { if (await signed(c) !== actor)
    throw new RequestsError('Current account changed.', 403); const { data, error } = await c.rpc('reconcile_request_operation', { target_tenant: q.tenantId, operation_id: q.operationId, action_name: q.action }); fail(error); const parsed = reconciliation.safeParse(data); if (!parsed.success)
    invalid(); const d = parsed.data; if (d.tenantId !== q.tenantId || d.actorId !== actor || d.operationId !== q.operationId || d.action !== q.action || d.saved && (d.saved.tenantId !== q.tenantId || d.saved.actorId !== actor || d.saved.role !== d.role || d.saved.operationId !== q.operationId || d.saved.action !== q.action))
    invalid(); return d; } const first = await fresh(), second = await fresh(); if (first.role !== second.role)
    throw new RequestsError('Current Requests role changed.', 403); if (first.status !== second.status || JSON.stringify(first.saved) !== JSON.stringify(second.saved))
    invalid(); return second; }
