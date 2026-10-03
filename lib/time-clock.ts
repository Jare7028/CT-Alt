import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TimeClockData, TimeClockEntriesData, TimeClockQuery, TimeClockSaved } from './time-clock-types';
const revision = z.number().int().positive().max(2147483647);
const change = z.discriminatedUnion('action', [
  z.object({action:z.literal('create_job'),name:z.string().trim().min(1).max(100)}).strict(),
  z.object({action:z.literal('archive_job'),jobId:z.uuid(),revision}).strict(),
  z.object({action:z.literal('clock_in'),jobId:z.uuid()}).strict(),
  z.object({action:z.literal('break_start'),entryId:z.uuid(),revision,paid:z.boolean()}).strict(),
  z.object({action:z.literal('break_end'),entryId:z.uuid(),revision}).strict(),
  z.object({action:z.literal('clock_out'),entryId:z.uuid(),revision}).strict(),
]);
export const timeClockMutation = z.object({tenantId:z.uuid(),operationId:z.uuid(),change}).strict();
const date = z.iso.date().refine(value=>!value.startsWith('0000-'));
const cursorSchema = z.object({tenantId:z.uuid(),actorId:z.uuid(),mode:z.enum(['attendance','timesheets']),timeZone:z.string().min(1).max(100),
  startDate:date.nullable(),endDate:date.nullable(),today:date.nullable(),startedAt:z.iso.datetime({offset:true}),entryId:z.uuid()}).strict();
export class TimeClockError extends Error {
  status: number;
  constructor(message: string,status=503){super(message);this.status=status;}
}
export function parseTimeClockQuery(params: URLSearchParams): TimeClockQuery {
  if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new TimeClockError('Choose valid clock filters.',400);
  const parsed=z.object({tenantId:z.uuid(),mode:z.enum(['status','attendance','timesheets']).optional(),
    limit:z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(value=>value<=100).optional(),
    startDate:date.optional(),endDate:date.optional(),cursor:z.string().regex(/^[A-Za-z0-9_-]+$/).max(1000).optional()}).strict().safeParse(Object.fromEntries(params));
  if(!parsed.success)throw new TimeClockError('Choose valid clock filters.',400);
  const value={...parsed.data,mode:parsed.data.mode??'status',limit:parsed.data.limit??50};
  if(value.startDate&&value.endDate&&value.startDate>value.endDate)throw new TimeClockError('Start date must be before or on the end date.',400);
  if(value.mode==='status'&&(value.cursor||value.startDate||value.endDate)||value.mode==='attendance'&&(value.startDate||value.endDate))throw new TimeClockError('These filters do not apply to this clock view.',400);
  return value;
}
export function decodeTimeClockCursor(value?: string) {
  if(!value)return null;
  let decoded: unknown;
  try {if(value.length>1000||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();decoded=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}
  catch {throw new TimeClockError('Choose a valid clock cursor.',400);}
  const parsed=cursorSchema.safeParse(decoded);
  if(!parsed.success)throw new TimeClockError('Choose a valid clock cursor.',400);
  return parsed.data;
}
function databaseError(code: string) {
  if(code==='42501')return new TimeClockError('You do not have permission for this clock action. An active linked agent is required to clock in or out.',403);
  if(code==='P0002')return new TimeClockError('That job or clock entry is unavailable.',404);
  if(['40001','40P01','23505'].includes(code))return new TimeClockError('Clock state or job changed. Reload before continuing.',409);
  if(['22023','23514','23502','22P02','22003','22007','22008'].includes(code))return new TimeClockError('Choose valid clock fields and calendar filters.',400);
  return new TimeClockError('The clock request could not be confirmed. Reload and review before making another change.');
}
export function supportedTimeClockZone(timeZone: unknown): timeZone is string {
  if(typeof timeZone!=='string'||['Factory','localtime','posixrules'].includes(timeZone)||timeZone.startsWith('posix/')||timeZone.startsWith('right/'))return false;
  try {new Intl.DateTimeFormat('en-US',{timeZone}).format(0);return true;}catch{return false;}
}
async function signedIn(client: SupabaseClient) {
  const {data:{user},error}=await client.auth.getUser();
  if(error||!user)throw new TimeClockError('Sign in to continue.',401);
}
export function readTimeClock(client: SupabaseClient,query: TimeClockQuery & {mode:'status'}): Promise<TimeClockData>;
export function readTimeClock(client: SupabaseClient,query: TimeClockQuery & {mode:'attendance'|'timesheets'}): Promise<TimeClockEntriesData>;
export function readTimeClock(client: SupabaseClient,query: TimeClockQuery): Promise<TimeClockData|TimeClockEntriesData>;
export async function readTimeClock(client: SupabaseClient,query: TimeClockQuery): Promise<TimeClockData | TimeClockEntriesData> {
  await signedIn(client);
  const {data,error}=await client.rpc('read_time_clock',{target_tenant:query.tenantId,view_mode:query.mode,page_limit:query.limit,start_date:query.startDate??null,end_date:query.endDate??null,after_entry:decodeTimeClockCursor(query.cursor)});
  if(error)throw databaseError(error.code);
  if(!data||typeof data.serverTime!=='string')throw new TimeClockError('Clock records could not be loaded.');
  if(query.mode==='status') {
    if(!Array.isArray(data.jobs)||!('entry' in data)||typeof data.actorId!=='string'||!supportedTimeClockZone(data.company?.time_zone))throw new TimeClockError('Clock status could not be loaded.');
    return data as TimeClockData;
  }
  if(!Array.isArray(data.entries)||!supportedTimeClockZone(data.timeZone))throw new TimeClockError('Clock history could not be loaded.');
  return {...data,nextCursor:data.nextCursor?Buffer.from(JSON.stringify(cursorSchema.parse(data.nextCursor))).toString('base64url'):null} as TimeClockEntriesData;
}
export async function saveTimeClock(client: SupabaseClient,payload:z.infer<typeof timeClockMutation>):Promise<TimeClockSaved> {
  await signedIn(client);
  const {data,error}=await client.rpc('save_time_clock',{target_tenant:payload.tenantId,operation_id:payload.operationId,change:payload.change});
  if(error)throw databaseError(error.code);
  const expectedRevision='revision' in payload.change?payload.change.revision+1:1;
  if(!data||data.revision!==expectedRevision||('entryId' in payload.change&&data.entryId!==payload.change.entryId)||('jobId' in payload.change&&data.jobId!==payload.change.jobId)||data.operationId!==payload.operationId||data.action!==payload.change.action||!Number.isInteger(data.revision)||data.revision<1||!z.uuid().safeParse(data.jobId).success||(!['create_job','archive_job'].includes(data.action)&&!z.uuid().safeParse(data.entryId).success))throw new TimeClockError('The clock acknowledgement could not be verified. Reload and review before making another change.');
  return data;
}
