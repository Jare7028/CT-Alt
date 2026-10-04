import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {FormsAnswers, FormsField, FormsIdentity, FormsResponseSummary} from './forms-types';
import type * as R from './forms-reporting-types';
import {formsAnswersValid, formsSchema, formsStringValid, formsSemanticJSON} from './forms';
import {formsReportWorkbook} from './forms-xlsx';

export class FormsReportingError extends Error {
  status: number;
  constructor(message: string, status = 503) {super(message); this.status = status;}
}
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const uuid = z.uuid().transform(v => v.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = (n: number) => z.string().max(n).refine(v => v.length <= n && formsStringValid(v));
const name = text(100).refine(v => !!v.trim());
const person = text(200).refine(v => !!v.trim() && Array.from(v).length <= 100);
const role = z.enum(['owner', 'admin']);
const digest = z.string().regex(/^[a-f0-9]{32}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && !v.startsWith('0000');
});
const utc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine(v => date.safeParse(v.slice(0, 10)).success && z.iso.datetime().safeParse(v).success);
const kind = z.enum(['entries', 'status', 'summary', 'field']);
const filtersSchema = z.object({from: date.nullable(), to: date.nullable(),
  review: z.enum(['all', 'reviewed', 'not_reviewed']), search: text(100).refine(v => v.length <= 100 && Buffer.byteLength(v) <= 512),
  submission: z.enum(['all', 'submitted', 'not_submitted']), fieldId: uuid.nullable(),
  fieldAnswer: z.enum(['all', 'answered', 'empty'])}).strict().refine(f => {
  if ((f.from === null) !== (f.to === null)) return false;
  return f.from === null || f.to !== null && f.from <= f.to &&
    (Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86400000 + 1 <= 366;
});
const applicable = (v: {kind: R.FormsReportKind; filters: R.FormsReportFilters}) =>
  (v.kind === 'status' || v.filters.submission === 'all') &&
  (v.kind === 'field' ? v.filters.fieldId !== null : v.filters.fieldId === null && v.filters.fieldAnswer === 'all');
const token = z.string().regex(/^[A-Za-z0-9_-]+$/).max(6000);
const querySchema = z.object({tenantId: uuid, formId: uuid, kind, filters: filtersSchema,
  limit: z.number().int().min(1).max(100), cursor: token.optional()}).strict()
  .refine(applicable).refine(q => q.kind !== 'summary' || q.limit === 50 && q.cursor === undefined);
const exportQuerySchema = z.object({tenantId: uuid, formId: uuid, kind: z.enum(['entries', 'status']),
  filters: filtersSchema}).strict().refine(applicable);
function invalid(message = 'Forms report could not be verified.'): never {throw new FormsReportingError(message);}
function queryError(): never {throw new FormsReportingError('Choose valid report filters, dates and paging.', 400);}
function parse(p: URLSearchParams, formId: string, exporting: boolean) {
  const seen = new Set<string>();
  for (const [key] of p) {if (seen.has(key)) queryError(); seen.add(key);}
  const shape = z.object({tenantId: uuid, kind: kind.optional(), from: date.optional(), to: date.optional(),
    review: filtersSchema.shape.review.optional(), search: filtersSchema.shape.search.optional(),
    submission: filtersSchema.shape.submission.optional(), fieldId: uuid.optional(), fieldAnswer: filtersSchema.shape.fieldAnswer.optional(),
    ...(!exporting ? {limit: z.coerce.number().int().min(1).max(100).optional(), cursor: token.optional()} : {})}).strict();
  const result = shape.safeParse(Object.fromEntries(p));
  const f = uuid.safeParse(formId);
  if (!result.success || !f.success) queryError();
  const q = result.data;
  const common = {tenantId: q.tenantId, formId: f.data, kind: q.kind ?? 'entries',
    filters: {from: q.from ?? null, to: q.to ?? null, review: q.review ?? 'all', search: q.search ?? '',
      submission: q.submission ?? 'all', fieldId: q.fieldId ?? null, fieldAnswer: q.fieldAnswer ?? 'all'}};
  if (exporting) {const v = exportQuerySchema.safeParse(common); if (!v.success) queryError(); return v.data;}
  const page = q as typeof q & {limit?: number; cursor?: string};
  const v = querySchema.safeParse({...common, limit: page.limit ?? 50, ...(page.cursor ? {cursor: page.cursor} : {})});
  if (!v.success) queryError();
  return v.data;
}
export const parseFormsReportQuery = (p: URLSearchParams, id: string): R.FormsReportQuery => parse(p, id, false) as R.FormsReportQuery;
export const parseFormsReportExportQuery = (p: URLSearchParams, id: string): R.FormsReportExportQuery => parse(p, id, true) as R.FormsReportExportQuery;
const identity = {tenantId: uuid, actorId: uuid, role};
const companySchema = z.object({id: uuid, name: text(200), time_zone: text(100).min(1)}).strict();
const caps = z.object({canEdit: z.boolean(), canPublish: z.boolean(), canArchive: z.boolean(), canRestore: z.boolean(),
  canSaveProgress: z.boolean(), canSubmit: z.boolean(), canEditResponse: z.boolean(), canViewResponses: z.boolean()}).strict();
const formSchema = z.object({id: uuid, name, description: text(500), status: z.enum(['draft','published','archived']),
  restoreStatus: z.enum(['draft','published']).nullable(), revision, schemaFrozen: z.boolean(), allowRespondentEdit: z.boolean(),
  isAssigned: z.boolean(), audienceCount: count.max(500), eligibleAudienceCount: count.max(500), createdAt: utc, updatedAt: utc,
  capabilities: caps, ownResponse: z.null()}).strict().refine(f => f.eligibleAudienceCount <= f.audienceCount &&
  (f.status === 'archived') === (f.restoreStatus !== null) && !f.capabilities.canSaveProgress &&
  !f.capabilities.canSubmit && !f.capabilities.canEditResponse && f.capabilities.canViewResponses &&
  (f.status !== 'archived' || !f.capabilities.canEdit && !f.capabilities.canPublish && !f.capabilities.canArchive));
const responseSchema = z.object({id: uuid, formId: uuid, actorId: uuid, authorName: person, revision, status: z.literal('submitted'),
  submittedAt: utc, updatedAt: utc, lastEditedBy: uuid, lastEditorName: person, lastEditedAt: utc,
  reviewed: z.boolean(), reviewedAt: utc.nullable(), reviewedBy: uuid.nullable(), reviewerName: person.nullable(),
  canEdit: z.boolean(), canReview: z.boolean()}).strict().refine(v => v.reviewed
  ? v.reviewedAt !== null && v.reviewedBy !== null && v.reviewerName !== null
  : v.reviewedAt === null && v.reviewedBy === null && v.reviewerName === null);
const answersSchema = z.record(uuid, z.union([text(5000), z.boolean(), z.array(uuid).max(50)]));
const exportRow = responseSchema.safeExtend({answers: answersSchema, formName: name}).strict();
const countsSchema = z.object({total: count, reviewed: count, notReviewed: count}).strict().refine(v => v.total === v.reviewed + v.notReviewed);
const base = {...identity, company: companySchema, form: formSchema, filters: filtersSchema, collectionVersion: digest, serverTime: utc};
const cursorSchema = z.object({scope: z.object({...identity, formId: uuid, kind, filters: filtersSchema, version: digest}).strict(),
  position: z.object({id: uuid, key: text(200)}).strict()}).strict();
const rawCursor = cursorSchema.nullable();
const statusCounts = z.object({total: count.max(500), submitted: count.max(500), notSubmitted: count.max(500), eligible: count.max(500),
  assignmentTotal: count.max(500), assignmentEligible: count.max(500)}).strict().refine(c => c.total === c.submitted + c.notSubmitted &&
  c.eligible <= c.total && c.assignmentEligible <= c.assignmentTotal && c.total <= c.assignmentTotal && c.eligible <= c.assignmentEligible);
const statusUser = z.object({actorId: uuid, name: person, eligible: z.boolean(), response: responseSchema.nullable()}).strict();
const fieldStats = z.object({fieldId: uuid, total: count, answered: count, empty: count,
  options: z.array(z.object({id: z.string(), label: text(100), count}).strict()).max(50)}).strict().refine(f => f.total === f.answered + f.empty);
const fieldSchema = formsSchema.transform(v => v[0]).refine(f => f && f.kind !== 'description');
const fieldRow = z.object({response: responseSchema, answer: z.union([text(5000),z.boolean(),z.array(uuid).max(50)]).nullable(), answered: z.boolean()}).strict();
function schemaFor(k: R.FormsReportKind, exporting: boolean) {
  if (k === 'entries') return z.object({...base, kind: z.literal('entries'), responses: z.array(exporting ? exportRow : responseSchema).max(exporting ? 10000 : 100),
    counts: countsSchema, ...(exporting ? {schema: formsSchema} : {nextCursor: rawCursor})}).strict();
  if (k === 'status') return z.object({...base, kind: z.literal('status'), users: z.array(statusUser).max(exporting ? 500 : 100),
    counts: statusCounts, ...(!exporting ? {nextCursor: rawCursor} : {})}).strict();
  if (k === 'summary') return z.object({...base, kind: z.literal('summary'), schema: formsSchema, counts: countsSchema,
    fields: z.array(fieldStats).max(50)}).strict();
  return z.object({...base, kind: z.literal('field'), field: z.unknown().transform(v => fieldSchema.parse([v])),
    responses: z.array(fieldRow).max(100), counts: z.object({total: count, answered: count, empty: count, matched: count}).strict()
      .refine(c => c.total === c.answered + c.empty && c.matched <= c.total), nextCursor: rawCursor}).strict();
}
export function decodeFormsReportCursor(v?: string) {
  if (!v) return null;
  try {
    if (!token.safeParse(v).success) queryError();
    const c = cursorSchema.parse(JSON.parse(Buffer.from(v,'base64url').toString('utf8')));
    if (c.scope.kind === 'summary' || c.scope.kind !== 'status' && !utc.safeParse(c.position.key).success) queryError();
    if (Buffer.from(JSON.stringify(c)).toString('base64url') !== v) queryError();
    return c;
  } catch {throw new FormsReportingError('Choose a valid reporting cursor.',400);}
}
function answered(field: FormsField, value: FormsAnswers[string] | null) {
  if (value === null) return false;
  if (field.kind === 'text') return typeof value === 'string' && !!value.trim();
  if (field.kind === 'multiple_choice') return Array.isArray(value) && value.length > 0;
  return true;
}
function responseFilter(row: FormsResponseSummary, q: R.FormsReportQuery | R.FormsReportExportQuery) {
  if (row.formId !== q.formId || q.filters.review === 'reviewed' && !row.reviewed || q.filters.review === 'not_reviewed' && row.reviewed) invalid();
}
function compareDate(row: FormsResponseSummary, filters: R.FormsReportFilters, tz: string) {
  if (filters.from === null) return;
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone: tz, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(row.submittedAt!));
  const civil = ['year','month','day'].map(k => parts.find(p => p.type === k)?.value).join('-');
  if (civil < filters.from || civil > filters.to!) invalid('Submission is outside the requested company calendar.');
}
/** SQL returns raw structured cursors; browser receives only canonical tokens. */
export function decodeFormsReportData(raw: unknown, q: R.FormsReportQuery | R.FormsReportExportQuery, exporting = false): R.FormsReportData | R.FormsReportExportData {
  try {
    if (size(raw) > 8388608) throw new FormsReportingError('The report exceeds the supported output size.',413);
    const result = schemaFor(q.kind,exporting).safeParse(raw);
    if (!result.success) invalid();
    const d = result.data as unknown as R.FormsReportData | R.FormsReportExportData;
    if (d.tenantId !== q.tenantId || d.company.id !== q.tenantId || d.form.id !== q.formId || JSON.stringify(d.filters) !== JSON.stringify(q.filters)) invalid();
    try {new Intl.DateTimeFormat('en',{timeZone:d.company.time_zone}).format();} catch {invalid('Company report calendar could not be verified.');}
    if ('schema' in d && d.counts.total * Buffer.byteLength(formsSemanticJSON(d.schema)) > 67108864) throw new FormsReportingError('The complete schema validation scope exceeds its supported workload.',413);
    if (d.kind === 'field' && d.counts.total > 10000) throw new FormsReportingError('The complete field scope exceeds its supported size.',413);
    if (d.kind === 'entries') {
      if (new Set(d.responses.map(r => r.id)).size !== d.responses.length || d.responses.length > d.counts.total ||
        (!exporting && d.responses.length > (q as R.FormsReportQuery).limit) || exporting && d.responses.length !== d.counts.total) invalid();
      d.responses.forEach((r,i) => {responseFilter(r,q);compareDate(r,q.filters,d.company.time_zone);
        if (i && (r.submittedAt! > d.responses[i-1].submittedAt! || r.submittedAt === d.responses[i-1].submittedAt && r.id >= d.responses[i-1].id)) invalid();});
      if ('schema' in d) {
        if (d.counts.total > 10000 || d.responses.reduce((n,r) => n + Buffer.byteLength(formsSemanticJSON(r.answers)),0) > 2097152) throw new FormsReportingError('The complete report exceeds its supported answer scope.',413);
        for (const r of d.responses) if (!formsAnswersValid(d.schema,r.answers,true)) invalid();
        if (d.responses.filter(r => r.reviewed).length !== d.counts.reviewed) invalid();
      }
    } else if (d.kind === 'status') {
      if (new Set(d.users.map(u => u.actorId)).size !== d.users.length || d.users.length > d.counts.total ||
        (!exporting && d.users.length > (q as R.FormsReportQuery).limit) || exporting && d.users.length !== d.counts.total ||
        d.counts.assignmentTotal !== d.form.audienceCount || d.counts.assignmentEligible !== d.form.eligibleAudienceCount) invalid();
      for (const u of d.users) {if (u.response) {responseFilter(u.response,q);compareDate(u.response,q.filters,d.company.time_zone);if (u.response.actorId !== u.actorId) invalid();}
        if (q.filters.submission === 'submitted' && !u.response || q.filters.submission === 'not_submitted' && u.response) invalid();}
      if (exporting && (d.users.filter(u => u.response).length !== d.counts.submitted || d.users.filter(u => u.eligible).length !== d.counts.eligible)) invalid();
    } else if (d.kind === 'summary') {
      if (d.counts.total > 10000) throw new FormsReportingError('The complete summary exceeds the supported scope.',413);
      const fields = d.schema.filter(f => f.kind !== 'description');
      if (d.fields.length !== fields.length) invalid();
      d.fields.forEach((s,i) => {const f = fields[i];if (s.fieldId !== f.id || s.total !== d.counts.total) invalid();
        const options = f.kind === 'yes_no' ? [{id:'true',label:'Yes'},{id:'false',label:'No'}] : 'options' in f ? f.options : [];
        if (s.options.length !== options.length || s.options.some((o,j) => o.id !== options[j].id || o.label !== options[j].label || o.count > s.answered)) invalid();
        const sum = s.options.reduce((n,o) => n+o.count,0);
        if ((f.kind === 'yes_no' || f.kind === 'single_choice') && sum !== s.answered || f.kind === 'multiple_choice' && sum < s.answered) invalid();
      });
    } else {
      if (d.field.id !== q.filters.fieldId || !d.form.schemaFrozen || new Set(d.responses.map(r => r.response.id)).size !== d.responses.length ||
        d.responses.length > (q as R.FormsReportQuery).limit || d.responses.length > d.counts.matched ||
        d.counts.matched !== (q.filters.fieldAnswer === 'answered' ? d.counts.answered : q.filters.fieldAnswer === 'empty' ? d.counts.empty : d.counts.total)) invalid();
      for (const [i,r] of d.responses.entries()) {if (i && (r.response.submittedAt! > d.responses[i-1].response.submittedAt! || r.response.submittedAt === d.responses[i-1].response.submittedAt && r.response.id >= d.responses[i-1].response.id)) invalid();responseFilter(r.response,q);compareDate(r.response,q.filters,d.company.time_zone);
        if (!formsAnswersValid([d.field],r.answer === null ? {} : {[d.field.id]:r.answer},true) || r.answered !== answered(d.field,r.answer) ||
          q.filters.fieldAnswer === 'answered' && !r.answered || q.filters.fieldAnswer === 'empty' && r.answered) invalid();}
    }
    if ('nextCursor' in d) {
      const c = result.data as unknown as {nextCursor:z.infer<typeof cursorSchema>|null};
      const next = c.nextCursor;
      const last = d.kind === 'status' ? d.users.at(-1)?.actorId : d.kind === 'field' ? d.responses.at(-1)?.response.id : d.responses.at(-1)?.id;
      const key = d.kind === 'status' ? undefined : d.kind === 'field' ? d.responses.at(-1)?.response.submittedAt : d.responses.at(-1)?.submittedAt;
      if (next && (!last || next.position.id !== last || key !== undefined && next.position.key !== key ||
        next.scope.tenantId !== d.tenantId || next.scope.actorId !== d.actorId || next.scope.role !== d.role || next.scope.formId !== q.formId ||
        next.scope.kind !== q.kind || next.scope.version !== d.collectionVersion || JSON.stringify(next.scope.filters) !== JSON.stringify(q.filters))) invalid('Reporting continuation could not be verified.');
      d.nextCursor = next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null;
    }
    return d;
  } catch (e) {if (e instanceof FormsReportingError) throw e; invalid();}
}
function databaseError(e: {code?:string}) {
  const status = e.code === '42501' ? 403 : e.code === '40001' ? 409 : e.code === '54000' ? 413 : e.code?.startsWith('22') ? 400 : 503;
  return new FormsReportingError(status === 403 ? 'Current Forms reporting access is unavailable.' : status === 409 ? 'The report changed. Refresh and review.' :
    status === 413 ? 'The complete report exceeds the supported scope.' : status === 400 ? 'Choose valid reporting filters.' : 'Forms report could not be verified.',status);
}
const accessSchema = z.object({...identity, formId:uuid, formRevision:revision, collectionVersion:digest, company:companySchema}).strict();
async function recheck(c:SupabaseClient,d:R.FormsReportBase) {
  const {data,error} = await c.rpc('read_forms_reporting_access',{target_tenant:d.tenantId,target_form:d.form.id});
  if (error) throw databaseError(error);
  const result = accessSchema.safeParse(data);
  if (!result.success) invalid('Current reporting access could not be verified.');
  const a = result.data;
  if (a.tenantId !== d.tenantId || a.actorId !== d.actorId || a.role !== d.role || a.formId !== d.form.id || a.company.id !== d.tenantId)
    throw new FormsReportingError('Company or reporting access changed.',403);
  if (a.formRevision !== d.form.revision || a.collectionVersion !== d.collectionVersion || a.company.name !== d.company.name || a.company.time_zone !== d.company.time_zone)
    throw new FormsReportingError('The report or company calendar changed. Refresh and review.',409);
}
async function read(c:SupabaseClient,q:R.FormsReportQuery|R.FormsReportExportQuery,exporting:boolean) {
  const parsed = (exporting ? exportQuerySchema : querySchema).safeParse(q);if (!parsed.success) queryError();q = parsed.data;
  const {data:{user},error:authError} = await c.auth.getUser();
  if (authError || !user) throw new FormsReportingError('Sign in to view Forms reporting.',401);
  if (user.is_anonymous) throw new FormsReportingError('Current Forms reporting access is unavailable.',403);
  const after = decodeFormsReportCursor((q as R.FormsReportQuery).cursor);
  if (after && (after.scope.actorId !== user.id || after.scope.tenantId !== q.tenantId)) throw new FormsReportingError('Cursor belongs to another account or company.',409);
  const {data,error} = await c.rpc('read_forms_reporting',{target_tenant:q.tenantId,target_form:q.formId,report_kind:q.kind,filters:q.filters,
    page_limit:'limit' in q ? q.limit : 50,after_item:after,export_all:exporting});
  if (error) throw databaseError(error);
  const d = decodeFormsReportData(data,q,exporting);
  if (d.actorId !== user.id) invalid('Signed reporting identity could not be verified.');
  await recheck(c,d);
  return d;
}
export async function readFormsReport(c:SupabaseClient,q:R.FormsReportQuery):Promise<R.FormsReportData> {
  return await read(c,q,false) as R.FormsReportData;
}
export async function exportFormsReport(c:SupabaseClient,q:R.FormsReportExportQuery):Promise<R.FormsReportExport> {
  const d = await read(c,q,true) as R.FormsReportExportData;
  let bytes:Uint8Array;
  try {bytes = formsReportWorkbook(d);} catch (e) {throw new FormsReportingError('The complete workbook could not be constructed.',(e as {status?:number})?.status === 413 ? 413 : 503);}
  if (bytes.byteLength > 8388608) throw new FormsReportingError('The complete workbook exceeds the supported size.',413);
  await recheck(c,d);
  const identity:FormsIdentity = {tenantId:d.tenantId,actorId:d.actorId,role:d.role};
  return {bytes,filename:`forms-${d.form.id}-${d.kind}.xlsx`,identity,formId:d.form.id,collectionVersion:d.collectionVersion,formRevision:d.form.revision};
}
/** Complete scope is verified before creating a pull-based deployment response. */
export function formsReportStream(source:Uint8Array):ReadableStream<Uint8Array> {
  if (source.byteLength > 8388608) throw new FormsReportingError('The complete workbook exceeds the supported size.',413);
  let bytes:Uint8Array|null = source,offset = 0;
  return new ReadableStream({pull(controller) {
    if (!bytes || offset === bytes.length) {bytes=null;controller.close();return;}
    const end = Math.min(offset+65536,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;
    if (offset === bytes.length) {bytes=null;controller.close();}
  },cancel() {bytes=null;}});
}
