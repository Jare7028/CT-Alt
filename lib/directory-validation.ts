import {z} from 'zod';
import {DIRECTORY_LIMITS as L} from './directory-types';
import type {DirectoryAccess,DirectoryCatalogue,DirectoryMutation,DirectorySaved,DirectoryReconciliation,DirectoryRecoveryQuery,DirectoryQuery,DirectoryAccessQuery} from './directory-types';
const uuid=z.uuid().transform(s=>s.toLowerCase());
const rev=z.number().int().min(0).max(2147483647);
const text=(max:number)=>z.string().refine(s=>s.length<=max&&s.isWellFormed()&&!/[\u0000-\u001f\u007f-\u009f]/.test(s));
const input=(max:number)=>text(max).transform(s=>s.trim());
const name=input(L.name).refine(s=>s.length>0);
const stored=(max:number)=>text(max).refine(s=>s===s.trim());
const action=z.enum(['activate','create','visibility']);
const base={schemaVersion:z.literal(1),company:z.object({id:uuid,name:z.string(),time_zone:z.string().min(1)}).strict(),actorId:uuid,role:z.enum(['owner','admin','manager','employee']),canManage:z.boolean(),active:z.boolean(),viewRevision:rev};
export const directoryAccessSchema:z.ZodType<DirectoryAccess>=z.object(base).strict().refine(s=>s.canManage===(s.role==='owner')&&(s.active||s.canManage)&&(s.active||s.viewRevision===0));
const contact=z.object({id:uuid,name:stored(L.name).refine(s=>s.length>0),description:stored(L.description),phone:stored(L.phone),email:stored(L.email),visible_in_app:z.boolean(),revision:rev.min(1),created_at:z.iso.datetime({precision:6}),updated_at:z.iso.datetime({precision:6})}).strict().refine(s=>s.updated_at>=s.created_at);
export const directoryCatalogueSchema:z.ZodType<DirectoryCatalogue>=z.object({...base,search:stored(L.search),contacts:z.array(contact).max(L.page),page:z.object({total:z.number().int().min(0).max(L.contacts),nextCursor:z.string().min(1).max(4096).nullable()}).strict()}).strict().refine(s=>s.canManage===(s.role==='owner')&&(s.active||s.canManage)&&(s.active||s.viewRevision===0)&&s.contacts.length<=s.page.total&&new Set(s.contacts.map(c=>c.id)).size===s.contacts.length&&s.contacts.every(c=>s.canManage||c.visible_in_app)&&(!s.page.nextCursor||s.contacts.length>0)&&(!s.active?s.page.total===0&&s.contacts.length===0&&s.page.nextCursor===null:true));
export const directoryQuerySchema:z.ZodType<DirectoryQuery>=z.object({tenantId:uuid,q:input(L.search).optional(),limit:z.number().int().min(1).max(L.page).optional(),cursor:z.string().min(1).max(4096).optional()}).strict();
export const directoryAccessQuerySchema:z.ZodType<DirectoryAccessQuery>=z.object({mode:z.literal('access'),tenantId:uuid}).strict();
export const directoryMutationSchema:z.ZodType<DirectoryMutation>=z.object({tenantId:uuid,operationId:uuid,change:z.discriminatedUnion('action',[
 z.object({action:z.literal('activate'),directory_revision:rev.max(2147483646)}).strict(),
 z.object({action:z.literal('create'),directory_revision:rev.max(2147483646),name,description:input(L.description),phone:input(L.phone),email:input(L.email)}).strict(),
 z.object({action:z.literal('visibility'),directory_revision:rev.max(2147483646),contact_id:uuid,contact_revision:rev.min(1).max(2147483646),visible_in_app:z.boolean()}).strict()
])}).strict();
export const directorySavedSchema:z.ZodType<DirectorySaved>=z.object({schemaVersion:z.literal(1),tenantId:uuid,actorId:uuid,operationId:uuid,action,directory_revision:rev.min(1),contact_id:uuid.nullable(),contact_revision:rev.min(1).nullable(),active:z.literal(true)}).strict().refine(s=>s.action==='activate'?s.contact_id===null&&s.contact_revision===null:s.contact_id!==null&&s.contact_revision!==null);
const recovery={mode:z.literal('reconcile'),tenantId:uuid,operationId:uuid,action,contactId:uuid.nullable()};
export const directoryRecoverySchema:z.ZodType<DirectoryRecoveryQuery>=z.object(recovery).strict().refine(s=>(s.action==='visibility')===(s.contactId!==null));
const reconciliation={schemaVersion:z.literal(1),tenantId:uuid,actorId:uuid,operationId:uuid,action,contactId:uuid.nullable()};
export const directoryReconciliationSchema:z.ZodType<DirectoryReconciliation>=z.discriminatedUnion('status',[
 z.object({...reconciliation,status:z.literal('recorded'),saved:directorySavedSchema}).strict(),
 z.object({...reconciliation,status:z.literal('not_recorded'),saved:z.null()}).strict()
]).refine(s=>(s.action==='visibility')===(s.contactId!==null)&&(s.status!=='recorded'||s.saved.tenantId===s.tenantId&&s.saved.actorId===s.actorId&&s.saved.operationId===s.operationId&&s.saved.action===s.action&&(s.action!=='visibility'||s.saved.contact_id===s.contactId)));
export const parseDirectoryAccess=(v:unknown)=>directoryAccessSchema.parse(v);
export const parseDirectoryCatalogue=(v:unknown)=>directoryCatalogueSchema.parse(v);
export const parseDirectorySaved=(v:unknown)=>directorySavedSchema.parse(v);
export const parseDirectoryReconciliation=(v:unknown)=>directoryReconciliationSchema.parse(v);
