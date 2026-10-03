import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {QuickTasksData,QuickTaskDetailsData,QuickTaskSaved,QuickTaskQuery,QuickTaskAssigneesData,QuickTaskAssigneesQuery} from './quick-task-types';
const uuid=z.uuid().transform(value=>value.toLowerCase());
const date=z.iso.date().refine(value=>!value.startsWith('0000-')).nullable();
const revision=z.number().int().positive().max(2147483647);
const details={title:z.string().trim().min(1).max(150),description:z.string().max(5000),agentIds:z.array(uuid).min(1).max(25).refine(ids=>new Set(ids).size===ids.length),startDate:date,dueDate:date};
const update={taskId:uuid,revision};
export const quickTaskMutation=z.object({tenantId:uuid,operationId:uuid,change:z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),mode:z.enum(['group','separate']),publication:z.enum(['draft','published']),...details}).strict(),
 z.object({action:z.literal('edit'),...update,...details}).strict(),
 ...(['publish','complete','reopen','archive','restore'] as const).map(action=>z.object({action:z.literal(action),...update}).strict()),
]).refine(value=>!('startDate' in value)||!value.startDate||!value.dueDate||value.startDate<=value.dueDate)}).strict();
const cursorSchema=z.object({tenantId:uuid,actorId:uuid,agentId:uuid.nullable(),tab:z.enum(['all','mine','created','archived']),status:z.enum(['all','open','done']),search:z.string().max(100),overdue:z.boolean(),timeZone:z.string().min(1).max(100),createdAt:z.iso.datetime({offset:true}),taskId:uuid}).strict();
export class QuickTaskError extends Error {status:number;constructor(message:string,status=503){super(message);this.status=status;}}
export function parseQuickTaskQuery(params:URLSearchParams):QuickTaskQuery {
 if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new QuickTaskError('Choose valid task filters.',400);
 const value=z.object({tenantId:uuid,tab:z.enum(['all','mine','created','archived']).optional(),status:z.enum(['all','open','done']).optional(),search:z.string().max(100).optional(),overdue:z.enum(['true','false']).optional(),limit:z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(n=>n<=100).optional(),cursor:z.string().regex(/^[A-Za-z0-9_-]+$/).max(1500).optional()}).strict().safeParse(Object.fromEntries(params));
 if(!value.success)throw new QuickTaskError('Choose valid task filters.',400);
 return {...value.data,status:value.data.status??'all',search:value.data.search??'',overdue:value.data.overdue==='true',limit:value.data.limit??50};
}
export function decodeQuickTaskCursor(cursor?:string){
 if(!cursor)return null;let value:unknown;
 try{if(cursor.length>1500||!/^[A-Za-z0-9_-]+$/.test(cursor))throw new Error();value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{throw new QuickTaskError('Choose a valid task cursor.',400);}
 const parsed=cursorSchema.safeParse(value);if(!parsed.success)throw new QuickTaskError('Choose a valid task cursor.',400);return parsed.data;
}
function databaseError(code:string){return new QuickTaskError(code==='42501'?'Your current company permissions or assignment do not allow this task action.':['40001','40P01','23505'].includes(code)?'Task changed. Reload before continuing.':['22023','23514','23502','22P02','22003','22007','22008'].includes(code)?'Choose valid task details, calendar dates and active assignees.':'The task request could not be confirmed. Reload and review before making another change.',code==='42501'?403:['40001','40P01','23505'].includes(code)?409:['22023','23514','23502','22P02','22003','22007','22008'].includes(code)?400:503);}
async function signedIn(client:SupabaseClient){const{data:{user},error}=await client.auth.getUser();if(error||!user)throw new QuickTaskError('Sign in to continue.',401);}
function validZone(zone:unknown){if(typeof zone!=='string'||['Factory','localtime','posixrules'].includes(zone)||zone.startsWith('posix/')||zone.startsWith('right/'))return false;try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format(0);return true;}catch{return false;}}
export async function readQuickTasks(client:SupabaseClient,query:QuickTaskQuery):Promise<QuickTasksData>{
 await signedIn(client);const{data,error}=await client.rpc('read_quick_tasks',{target_tenant:query.tenantId,view_tab:query.tab??null,state_filter:query.status,search_text:query.search,overdue_only:query.overdue,page_limit:query.limit,after_task:decodeQuickTaskCursor(query.cursor)});
 if(error)throw databaseError(error.code);if(!data||!validZone(data.timeZone)||!Array.isArray(data.tasks)||!Array.isArray(data.assignableAgents)||typeof data.actorId!=='string'||typeof data.assignableAgentsHasMore!=='boolean'||!validCounts(data.counts))throw new QuickTaskError('Task records could not be loaded.');
 const rosterCursor=assigneeCursorSchema.nullable().safeParse(data.assignableAgentsCursor);
 if(!rosterCursor.success||data.assignableAgentsHasMore!==(rosterCursor.data!==null)||(rosterCursor.data&&(rosterCursor.data.tenantId!==query.tenantId||rosterCursor.data.actorId!==data.actorId||rosterCursor.data.search!=='')))throw new QuickTaskError('Assignable users could not be loaded.');
 return {...data,assignableAgentsCursor:rosterCursor.data?Buffer.from(JSON.stringify(rosterCursor.data)).toString('base64url'):null,nextCursor:data.nextCursor?Buffer.from(JSON.stringify(cursorSchema.parse(data.nextCursor))).toString('base64url'):null};
}
export async function readQuickTask(client:SupabaseClient,tenantId:string,taskId:string):Promise<QuickTaskDetailsData>{
 if(!uuid.safeParse(tenantId).success||!uuid.safeParse(taskId).success)throw new QuickTaskError('Choose a valid task.',400);
 await signedIn(client);const{data,error}=await client.rpc('read_quick_tasks',{target_tenant:tenantId,detail_id:taskId});if(error)throw databaseError(error.code);if(!data?.task||data.task.id!==taskId||!validZone(data.timeZone))throw new QuickTaskError('Task details could not be loaded.');return data;
}
export async function saveQuickTask(client:SupabaseClient,payload:z.infer<typeof quickTaskMutation>):Promise<QuickTaskSaved>{
 await signedIn(client);const{data,error}=await client.rpc('save_quick_task',{target_tenant:payload.tenantId,operation_id:payload.operationId,change:payload.change});if(error)throw databaseError(error.code);
 const expectedRevision=payload.change.action==='create'?1:payload.change.revision+1;
 const count=payload.change.action==='create'&&payload.change.mode==='separate'?payload.change.agentIds.length:1;
 if(!data||data.operationId!==payload.operationId||data.action!==payload.change.action||!Array.isArray(data.tasks)||data.tasks.length!==count||new Set(data.tasks.map((t:{id:string})=>t.id)).size!==count||data.tasks.some((t:{id:string;revision:number})=>!uuid.safeParse(t.id).success||t.revision!==expectedRevision)||('taskId' in payload.change&&data.tasks[0].id!==payload.change.taskId))throw new QuickTaskError('The task acknowledgement could not be verified. Reload and review before making another change.');return data;
}

function validCounts(value:unknown){
 const parsed=z.object({total:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),open:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),done:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),overdue:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict().safeParse(value);
 return parsed.success&&parsed.data.total===parsed.data.open+parsed.data.done&&parsed.data.overdue<=parsed.data.open;
}
const assigneeCursorSchema=z.object({tenantId:uuid,actorId:uuid,search:z.string().max(100),name:z.string().max(256),agentId:uuid}).strict();
export function parseQuickTaskAssigneesQuery(params:URLSearchParams):QuickTaskAssigneesQuery{
 if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new QuickTaskError('Choose valid assignee filters.',400);
 const parsed=z.object({tenantId:uuid,search:z.string().max(100).optional(),limit:z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(n=>n<=100).optional(),cursor:z.string().regex(/^[A-Za-z0-9_-]+$/).max(1500).optional()}).strict().safeParse(Object.fromEntries(params));
 if(!parsed.success)throw new QuickTaskError('Choose valid assignee filters.',400);
 return {...parsed.data,search:parsed.data.search??'',limit:parsed.data.limit??100};
}
export async function readQuickTaskAssignees(client:SupabaseClient,query:QuickTaskAssigneesQuery):Promise<QuickTaskAssigneesData>{
 let cursor=null;
 if(query.cursor){try{if(query.cursor.length>1500||!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new Error();cursor=assigneeCursorSchema.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));}catch{throw new QuickTaskError('Choose a valid assignee cursor.',400);}}
 await signedIn(client);const {data,error}=await client.rpc('read_quick_task_assignees',{target_tenant:query.tenantId,search_text:query.search,page_limit:query.limit,after_agent:cursor});
 if(error)throw databaseError(error.code);
 if(!data||!Array.isArray(data.agents)||data.agents.length>query.limit||data.agents.some((a:{id:string;name:string})=>!uuid.safeParse(a.id).success||typeof a.name!=='string'))throw new QuickTaskError('Assignable users could not be loaded.');
 let nextCursor=null;if(data.nextCursor){const parsed=assigneeCursorSchema.safeParse(data.nextCursor);if(!parsed.success)throw new QuickTaskError('Assignable users could not be loaded.');nextCursor=Buffer.from(JSON.stringify(parsed.data)).toString('base64url');}
 return {agents:data.agents,nextCursor};
}
