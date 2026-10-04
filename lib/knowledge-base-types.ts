import type {Company,Member} from './agent-types';

export type KnowledgeBaseStatus='draft'|'published'|'archived';
export type KnowledgeNodeStatus='active'|'archived';
export type KnowledgeView='manage'|'library';
export type KnowledgeNodeKind='folder'|'text'|'link';
export type KnowledgeIdentity={tenantId:string;actorId:string;role:Member['role'];view:KnowledgeView};
export type KnowledgeAssignee={actorId:string;name:string;eligible:boolean};
export type KnowledgeBase={id:string;name:string;description:string;status:KnowledgeBaseStatus;restoreStatus:'draft'|'published'|null;revision:number;audienceCount:number;eligibleAudienceCount:number;isAssigned:boolean;canRead:boolean;canEdit:boolean;canPublish:boolean;canArchive:boolean;canRestore:boolean};
export type KnowledgeNode={id:string;baseId:string;parentId:string|null;kind:KnowledgeNodeKind;name:string;description:string;status:KnowledgeNodeStatus;revision:number;depth:number;rank:string;activeChildCount:number;canEdit:boolean;canMove:boolean;canMoveEarlier:boolean;canMoveLater:boolean;canArchive:boolean;canRestore:boolean};
export type KnowledgePathItem={id:string;name:string;status:KnowledgeNodeStatus;revision:number};
export type KnowledgeReadScope=KnowledgeIdentity&{baseId:string;baseRevision:number;audienceVersion:string;treeVersion:string};
export type KnowledgeBasesData=KnowledgeIdentity&{company:Company;bases:KnowledgeBase[];counts:{total:number;draft:number;published:number;archived:number};catalogVersion:string;nextCursor:string|null;serverTime:string;capabilities:{canManage:boolean}};
export type KnowledgeBaseData=KnowledgeReadScope&{company:Company;base:KnowledgeBase;assignees:KnowledgeAssignee[];root:{activeChildCount:number};serverTime:string};
export type KnowledgeNodesData=KnowledgeReadScope&{base:KnowledgeBase;parent:KnowledgeNode|null;path:KnowledgePathItem[];nodes:KnowledgeNode[];matchedCount:number;nextCursor:string|null;serverTime:string};
export type KnowledgeNodeData=KnowledgeReadScope&{base:KnowledgeBase;node:KnowledgeNode;path:KnowledgePathItem[];body:string|null;url:string|null;serverTime:string};
export type KnowledgeSearchResult={node:KnowledgeNode;path:KnowledgePathItem[]};
export type KnowledgeSearchData=KnowledgeReadScope&{base:KnowledgeBase;results:KnowledgeSearchResult[];matchedCount:number;nextCursor:string|null;serverTime:string};
export type KnowledgeAssigneesData=KnowledgeIdentity&{users:KnowledgeAssignee[];matchedCount:number;rosterVersion:string;nextCursor:string|null;serverTime:string};
export type KnowledgeInsightUser={actorId:string;name:string;eligible:boolean;totalViews:string;lastViewedAt:string|null};
export type KnowledgeInsightsData=KnowledgeReadScope&{base:KnowledgeBase;node:KnowledgeNode|null;path:KnowledgePathItem[];eventVersion:string;timeZone:string;counts:{assigned:number;eligible:number;unavailable:number;distinctEligibleViewers:number;eligibleViewedPercentage:number|null;totalViews:string};users:KnowledgeInsightUser[];matchedCount:number;chart:{date:string;views:string}[];nextCursor:string|null;serverTime:string};
export type KnowledgeBasesQuery={tenantId:string;view:'auto'|KnowledgeView;status:'all'|KnowledgeBaseStatus;search:string;limit:number;cursor?:string};
export type KnowledgeBaseQuery={tenantId:string;baseId:string;view:'auto'|KnowledgeView};
export type KnowledgeNodesQuery=KnowledgeBaseQuery&{parentId?:string;status:'all'|KnowledgeNodeStatus;search:string;limit:number;cursor?:string};
export type KnowledgeNodeQuery=KnowledgeBaseQuery&{nodeId:string};
export type KnowledgeSearchQuery=KnowledgeBaseQuery&{search:string;limit:number;cursor?:string};
export type KnowledgeAssigneesQuery={tenantId:string;search:string;limit:number;cursor?:string};
export type KnowledgeInsightsQuery=KnowledgeBaseQuery&{nodeId?:string;search:string;limit:number;cursor?:string};
export type KnowledgeNodeContent={kind:'folder';name:string;description:string}|{kind:'text';name:string;description:string;body:string}|{kind:'link';name:string;description:string;url:string};
export type KnowledgeChange=
 |{action:'create_base';name:string;description:string;audienceIds:string[]}
 |{action:'edit_base';baseId:string;revision:number;name:string;description:string}
 |{action:'set_audience';baseId:string;revision:number;audienceIds:string[]}
 |{action:'publish_base'|'archive_base'|'restore_base';baseId:string;revision:number}
 |({action:'create_node';baseId:string;revision:number;parentId:string|null}&KnowledgeNodeContent)
 |({action:'edit_node';baseId:string;revision:number;nodeId:string;nodeRevision:number}&KnowledgeNodeContent)
 |{action:'move_node';baseId:string;revision:number;nodeId:string;nodeRevision:number;parentId:string|null}
 |{action:'order_node';baseId:string;revision:number;nodeId:string;nodeRevision:number;direction:'earlier'|'later'}
 |{action:'archive_node'|'restore_node';baseId:string;revision:number;nodeId:string;nodeRevision:number}
 |{action:'view';baseId:string;revision:number;nodeId:string|null;nodeRevision:number|null};
export type KnowledgeMutation={tenantId:string;operationId:string;change:KnowledgeChange};
export type KnowledgeSaved={operationId:string;action:KnowledgeChange['action'];baseId:string;revision:number;nodeId?:string;nodeRevision?:number;eventId?:string;recordedAt?:string};
export type KnowledgeViewReconciliation={tenantId:string;actorId:string;role:Member['role'];operationId:string;status:'recorded'|'not_recorded'};
