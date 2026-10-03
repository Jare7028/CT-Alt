import type {Company,Member} from './agent-types';
export type QuickTaskAssignee={id:string;name:string};
export type QuickTask={id:string;tenant_id:string;title:string;description:string;mode:'group'|'separate';publication:'draft'|'published';status:'open'|'done';archived:boolean;revision:number;created_by:string;created_at:string;start_date:string|null;due_date:string|null;completed_by:string|null;completed_name:string|null;completed_at:string|null;assignees:QuickTaskAssignee[];overdue:boolean;canComplete:boolean};
export type QuickTasksData={company:Company;role:Member['role'];actorId:string;agent:QuickTaskAssignee|null;capabilities:{canCreate:boolean;canViewAll:boolean;canManage:boolean};assignableAgents:QuickTaskAssignee[];assignableAgentsHasMore:boolean;assignableAgentsCursor:string|null;tasks:QuickTask[];counts:{total:number;open:number;done:number;overdue:number};nextCursor:string|null;serverTime:string;timeZone:string};
export type QuickTaskDetailsData={task:QuickTask;serverTime:string;timeZone:string};
type Details={title:string;description:string;agentIds:string[];startDate:string|null;dueDate:string|null};
export type QuickTaskChange=({action:'create';mode:'group'|'separate';publication:'draft'|'published'}&Details)|({action:'edit';taskId:string;revision:number}&Details)|{action:'publish'|'complete'|'reopen'|'archive'|'restore';taskId:string;revision:number};
export type QuickTaskSaved={operationId:string;action:QuickTaskChange['action'];tasks:{id:string;revision:number}[]};
export type QuickTaskQuery={tenantId:string;tab?:'all'|'mine'|'created'|'archived';status:'all'|'open'|'done';search:string;overdue:boolean;limit:number;cursor?:string};

export type QuickTaskAssigneesData={agents:QuickTaskAssignee[];nextCursor:string|null};
export type QuickTaskAssigneesQuery={tenantId:string;search:string;limit:number;cursor?:string};
