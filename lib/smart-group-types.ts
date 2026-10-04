import type {Company} from './agent-types';

export type SmartGroupStatus='active'|'archived';
export type SmartGroupRole='owner'|'admin';
export type SmartGroupRule={field:'title'|'team'|`custom:${string}`;values:string[]};
export type SmartGroupCounts={records:number;unlinked:number;eligible:number;unavailable:number};
export type SmartGroupField={key:SmartGroupRule['field'];label:string};
export type SmartGroupSegment={id:string;name:string;description:string;status:SmartGroupStatus;revision:number;activeGroupCount:number;canArchive:boolean;canRestore:boolean};
export type SmartGroup={id:string;segmentId:string;name:string;description:string;status:SmartGroupStatus;revision:number;rules:SmartGroupRule[];needsReview:boolean;invalidFields:string[];counts:SmartGroupCounts|null;canEdit:boolean;canArchive:boolean;canRestore:boolean};
export type SmartGroupMember={id:string;name:string;title:string;team:string;linkStatus:'unlinked'|'eligible'|'unavailable'};
export type SmartGroupIdentity={tenantId:string;actorId:string;role:SmartGroupRole;fieldFingerprint:string;datasetVersion:string};
export type SmartGroupsData=SmartGroupIdentity&{company:Company;fields:SmartGroupField[];groups:SmartGroup[];counts:{total:number;active:number;archived:number;needsReview:number};nextCursor:string|null;serverTime:string};
export type SmartGroupSegmentsData=SmartGroupIdentity&{segments:SmartGroupSegment[];counts:{total:number;active:number;archived:number};nextCursor:string|null;serverTime:string};
export type SmartGroupMembersData=SmartGroupIdentity&{group:SmartGroup;segment:SmartGroupSegment;fields:SmartGroupField[];members:SmartGroupMember[];counts:SmartGroupCounts|null;matchedCount:number|null;datasetVersion:string;nextCursor:string|null;serverTime:string};
export type SmartGroupPreviewData=SmartGroupIdentity&{fields:SmartGroupField[];rules:SmartGroupRule[];members:SmartGroupMember[];counts:SmartGroupCounts;matchedCount:number;datasetVersion:string;nextCursor:string|null;serverTime:string};
export type SmartGroupsQuery={tenantId:string;status:'all'|SmartGroupStatus;search:string;limit:number;segmentId?:string;cursor?:string};
export type SmartGroupSegmentsQuery={tenantId:string;status:'all'|SmartGroupStatus;search:string;limit:number;cursor?:string};
export type SmartGroupMembersQuery={tenantId:string;groupId:string;search:string;limit:number;cursor?:string};
export type SmartGroupPreviewInput={tenantId:string;rules:SmartGroupRule[];search?:string;limit?:number;cursor?:string};
export type SmartGroupChange=
 |{action:'create_segment';name:string;description:string}
 |{action:'edit_segment';segmentId:string;revision:number;name:string;description:string}
 |{action:'archive_segment'|'restore_segment';segmentId:string;revision:number}
 |{action:'create_group';segmentId:string;name:string;description:string;rules:SmartGroupRule[]}
 |{action:'edit_group';groupId:string;revision:number;segmentId:string;name:string;description:string;rules:SmartGroupRule[]}
 |{action:'archive_group'|'restore_group';groupId:string;revision:number};
export type SmartGroupMutation={tenantId:string;operationId:string;change:SmartGroupChange};
export type SmartGroupSaved={operationId:string;action:SmartGroupChange['action'];segmentId:string;groupId?:string;revision:number};
