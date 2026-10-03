import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {TimeOffData,TimeOffQuery,TimeOffSaved} from './time-off-types';
const uuid=z.uuid().transform(value=>value.toLowerCase());
const date=z.iso.date().refine(value=>!value.startsWith('0000-'));
const revision=z.number().int().positive().max(2147483647);
const reason=z.string().trim().max(1000);
export function timeOffCalendarDays(startDate:string,endDate:string){return Math.round((Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86400000)+1;}
const boundedRange=(value:{startDate:string;endDate:string})=>value.startDate<=value.endDate&&timeOffCalendarDays(value.startDate,value.endDate)<=366;
export const timeOffMutation=z.object({tenantId:uuid,operationId:uuid,change:z.discriminatedUnion('action',[
 z.object({action:z.literal('create_type'),name:z.string().trim().min(1).max(100),description:z.string().max(1000),paid:z.boolean()}).strict(),
 z.object({action:z.literal('archive_type'),typeId:uuid,revision}).strict(),
 z.object({action:z.literal('request'),agentId:uuid,typeId:uuid,startDate:date,endDate:date,note:z.string().max(2000)}).strict(),
 z.object({action:z.literal('withdraw'),requestId:uuid,revision}).strict(),
 z.object({action:z.literal('approve'),requestId:uuid,revision,reason:reason.default('')}).strict(),
 z.object({action:z.literal('reject'),requestId:uuid,revision,reason:reason.min(1)}).strict(),
 z.object({action:z.literal('cancel'),requestId:uuid,revision,reason:reason.min(1)}).strict(),
]).refine(value=>value.action!=='request'||boundedRange(value))}).strict();
const status=z.enum(['all','pending','approved','rejected','withdrawn','cancelled']);
const cursorSchema=z.object({tenantId:uuid,actorId:uuid,agentId:uuid.nullable(),role:z.enum(['owner','admin','manager','employee']),view:z.enum(['mine','team']),status,search:z.string().max(100),filterAgent:uuid.nullable(),typeId:uuid.nullable(),startDate:date.nullable(),endDate:date.nullable(),timeZone:z.string().min(1).max(100),requestedAt:z.iso.datetime({offset:true}),requestId:uuid}).strict();
export class TimeOffError extends Error {status:number;constructor(message:string,status=503){super(message);this.status=status;}}
export function parseTimeOffQuery(params:URLSearchParams):TimeOffQuery{
 if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new TimeOffError('Choose valid time off filters.',400);
 const parsed=z.object({tenantId:uuid,view:z.enum(['mine','team']).optional(),status:status.optional(),search:z.string().max(100).optional(),agentId:uuid.optional(),typeId:uuid.optional(),startDate:date.optional(),endDate:date.optional(),limit:z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(value=>value<=100).optional(),cursor:z.string().regex(/^[A-Za-z0-9_-]+$/).max(2000).optional()}).strict().safeParse(Object.fromEntries(params));
 if(!parsed.success)throw new TimeOffError('Choose valid time off filters.',400);
 const value={...parsed.data,view:parsed.data.view??'mine',status:parsed.data.status??'all',search:parsed.data.search??'',limit:parsed.data.limit??50};
 if(Boolean(value.startDate)!==Boolean(value.endDate)||(value.startDate&&value.endDate&&!boundedRange({startDate:value.startDate,endDate:value.endDate})))throw new TimeOffError('Choose up to366 inclusive calendar days for both filter dates.',400);
 return value;
}
export function decodeTimeOffCursor(value?:string){if(!value)return null;try{if(value.length>2000||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();return cursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8')));}catch{throw new TimeOffError('Choose a valid time off cursor.',400);}}
function databaseError(code:string){return new TimeOffError(code==='42501'?'Current company permissions or linked identity do not allow this time off action.':['40001','40P01','23505'].includes(code)?'Time off changed or approved leave overlaps. Reload before continuing.':['22023','23514','23502','22P02','22003','22007','22008'].includes(code)?'Choose valid leave details, active type, calendar dates and decision reason.':'The time off request could not be confirmed. Reload and review before making another change.',code==='42501'?403:['40001','40P01','23505'].includes(code)?409:['22023','23514','23502','22P02','22003','22007','22008'].includes(code)?400:503);}
function validZone(value:string){if(['Factory','localtime','posixrules'].includes(value)||value.startsWith('posix/')||value.startsWith('right/'))return false;try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0);return true;}catch{return false;}}
const person=z.object({id:uuid,name:z.string()}).strict();
const company=z.object({id:uuid,name:z.string(),time_zone:z.string().refine(validZone)}).strict();
const accessSchema=z.object({company,role:z.enum(['owner','admin','manager','employee']),actorId:uuid,agent:person.nullable()}).strict();
const safeCount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const countsSchema=z.object({total:safeCount,pending:safeCount,approved:safeCount,rejected:safeCount,withdrawn:safeCount,cancelled:safeCount}).strict().refine(value=>value.total===value.pending+value.approved+value.rejected+value.withdrawn+value.cancelled);
const timestamp=z.iso.datetime({offset:true});
const event=z.object({action:z.enum(['request','approve','reject','withdraw','cancel']),actor_name:z.string(),occurred_at:timestamp,revision,reason:z.string().nullable()}).strict();
const requestSchema=z.object({id:uuid,tenant_id:uuid,agent_id:uuid,agent_name:z.string(),type_id:uuid,type_name:z.string(),type_description:z.string(),type_paid:z.boolean(),start_date:date,end_date:date,calendar_days:z.number().int().min(1).max(366),note:z.string().max(4000).refine(value=>Array.from(value).length<=2000),status:z.enum(['pending','approved','rejected','withdrawn','cancelled']),revision,requested_by:uuid,requested_at:timestamp,decision_by:uuid.nullable(),decision_name:z.string().nullable(),decision_reason:z.string().nullable(),decided_at:timestamp.nullable(),history:z.array(event).max(3),canWithdraw:z.boolean(),canApprove:z.boolean(),canReject:z.boolean(),canCancel:z.boolean()}).strict().refine(value=>value.calendar_days===timeOffCalendarDays(value.start_date,value.end_date));
const typeSchema=z.object({id:uuid,name:z.string(),description:z.string(),paid:z.boolean(),status:z.enum(['active','archived']),revision,canArchive:z.boolean()}).strict();
const dataSchema=accessSchema.extend({types:z.array(typeSchema).max(100),requests:z.array(requestSchema).max(100),counts:countsSchema,nextCursor:cursorSchema.nullable(),serverTime:timestamp,timeZone:z.string().refine(validZone),capabilities:z.object({canRequest:z.boolean(),canManageTypes:z.boolean(),canViewTeam:z.boolean()}).strict()}).strict();
async function signedIn(client:SupabaseClient){const {data:{user},error}=await client.auth.getUser();if(error||!user)throw new TimeOffError('Sign in to continue.',401);return user;}
export async function readTimeOff(client:SupabaseClient,query:TimeOffQuery):Promise<TimeOffData>{
 const user=await signedIn(client);const {data,error}=await client.rpc('read_time_off',{target_tenant:query.tenantId,view_mode:query.view,state_filter:query.status,search_text:query.search,page_limit:query.limit,filter_agent:query.agentId??null,filter_type:query.typeId??null,start_date:query.startDate??null,end_date:query.endDate??null,after_request:decodeTimeOffCursor(query.cursor)});
 if(error)throw databaseError(error.code);const parsed=dataSchema.safeParse(data);if(!parsed.success)throw new TimeOffError('Time off records could not be verified.');const result=parsed.data;
 if(result.actorId!==user.id||result.company.id!==query.tenantId||result.timeZone!==result.company.time_zone||result.requests.length>query.limit||result.counts.total<result.requests.length||result.requests.some(r=>r.tenant_id!==query.tenantId||(query.view==='mine'&&(r.requested_by!==user.id||r.agent_id!==result.agent?.id))))throw new TimeOffError('Time off records could not be verified.');
 const capable=['owner','admin'].includes(result.role);
 if(result.capabilities.canManageTypes!==capable||result.capabilities.canViewTeam!==capable||result.capabilities.canRequest!==(result.agent!==null)||result.types.some(t=>t.status!=='active'||t.canArchive!==capable)||new Set(result.requests.map(r=>r.id)).size!==result.requests.length||result.requests.some(r=>query.status!=='all'&&r.status!==query.status))throw new TimeOffError('Time off records could not be verified.');
 if(result.nextCursor){const c=result.nextCursor;const last=result.requests.at(-1);if(c.tenantId!==query.tenantId||c.actorId!==user.id||c.agentId!==(result.agent?.id??null)||c.role!==result.role||c.view!==query.view||c.status!==query.status||c.search!==query.search||c.filterAgent!==(query.agentId??null)||c.typeId!==(query.typeId??null)||c.startDate!==(query.startDate??null)||c.endDate!==(query.endDate??null)||c.timeZone!==result.timeZone||result.requests.length!==query.limit||c.requestId!==last?.id||c.requestedAt!==last?.requested_at)throw new TimeOffError('Time off cursor could not be verified.');}
 // Reject changes committed during a long snapshot read before releasing private
 // notes or stale management capabilities. Authorization may change after this
 // final check; subsequent reads must check again and the UI must invalidate.
 const {data:fresh,error:accessError}=await client.rpc('read_time_off_access',{target_tenant:query.tenantId});
 if(accessError)throw accessError.code==='42501'?databaseError(accessError.code):new TimeOffError('Current time off access could not be checked.');
 const access=accessSchema.safeParse(fresh);if(!access.success)throw new TimeOffError('Current time off access could not be checked.');
 if(access.data.actorId!==user.id||access.data.company.id!==query.tenantId||access.data.role!==result.role||access.data.agent?.id!==result.agent?.id||access.data.company.time_zone!==result.company.time_zone)throw new TimeOffError('Time off identity or company changed. Reload and review.',403);
 return {...result,company:access.data.company,agent:access.data.agent,nextCursor:result.nextCursor?Buffer.from(JSON.stringify(result.nextCursor)).toString('base64url'):null};
}
export async function saveTimeOff(client:SupabaseClient,payload:z.infer<typeof timeOffMutation>):Promise<TimeOffSaved>{
 await signedIn(client);const {data,error}=await client.rpc('save_time_off',{target_tenant:payload.tenantId,operation_id:payload.operationId,change:payload.change});if(error)throw databaseError(error.code);
 const parsed=z.object({operationId:uuid,action:z.enum(['create_type','archive_type','request','withdraw','approve','reject','cancel']),typeId:uuid,requestId:uuid.optional(),revision}).strict().safeParse(data);
 const expected='revision' in payload.change?payload.change.revision+1:1;
 if(!parsed.success||parsed.data.operationId!==payload.operationId||parsed.data.action!==payload.change.action||parsed.data.revision!==expected||('typeId' in payload.change&&parsed.data.typeId!==payload.change.typeId)||('requestId' in payload.change&&parsed.data.requestId!==payload.change.requestId)||(['create_type','archive_type'].includes(payload.change.action)?parsed.data.requestId!==undefined:parsed.data.requestId===undefined))throw new TimeOffError('The time off acknowledgement could not be verified. Reload and review before making another change.');
 return parsed.data;
}
