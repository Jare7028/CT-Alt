import type {Company,Member} from './agent-types';

export const FORMS_LIMITS={audience:500,fields:50,options:50,name:100,description:500,fieldLabel:100,descriptionField:5000,textAnswer:5000,schemaBytes:131072,answersBytes:65536,requestBytes:262144,page:100,historyPage:10,search:100,searchBytes:512}as const;
export type FormsView='mine'|'manage';
export type FormsStatus='draft'|'published'|'archived';
export type FormsResponseStatus='in_progress'|'submitted';
export type FormsIdentity={tenantId:string;actorId:string;role:Member['role']};
export type FormsOption={id:string;label:string};
export type FormsField=
 |{id:string;kind:'description';text:string}
 |{id:string;kind:'text'|'yes_no'|'number';label:string;required:boolean}
 |{id:string;kind:'single_choice'|'multiple_choice';label:string;required:boolean;options:FormsOption[]};
export type FormsAnswer=string|boolean|string[];
/** Missing answers are omitted. Numeric answers are decimal strings, including incomplete progress values. */
export type FormsAnswers=Record<string,FormsAnswer>;
export type FormsAssignee={actorId:string;name:string;eligible:boolean};
export type FormsCapabilities={canEdit:boolean;canPublish:boolean;canArchive:boolean;canRestore:boolean;canSaveProgress:boolean;canSubmit:boolean;canEditResponse:boolean;canViewResponses:boolean};
export type FormsForm={id:string;name:string;description:string;status:FormsStatus;restoreStatus:'draft'|'published'|null;revision:number;schemaFrozen:boolean;allowRespondentEdit:boolean;isAssigned:boolean;audienceCount:number|null;eligibleAudienceCount:number|null;createdAt:string;updatedAt:string;capabilities:FormsCapabilities;ownResponse:{id:string;revision:number;status:FormsResponseStatus;submittedAt:string|null;updatedAt:string}|null};
export type FormsResponseSummary={id:string;formId:string;actorId:string;authorName:string;revision:number;status:FormsResponseStatus;submittedAt:string|null;updatedAt:string;lastEditedBy:string;lastEditorName:string;lastEditedAt:string;reviewed:boolean;reviewedAt:string|null;reviewedBy:string|null;reviewerName:string|null;canEdit:boolean;canReview:boolean};
export type FormsResponse=FormsResponseSummary&{answers:FormsAnswers;schema:FormsField[];formName:string};
export type FormsHistoryItem={id:string;responseId:string;revision:number;answers:FormsAnswers;formName:string;status:FormsResponseStatus;submittedAt:string|null;updatedAt:string;lastEditedBy:string;lastEditorName:string;lastEditedAt:string;reviewed:boolean;reviewedAt:string|null;reviewedBy:string|null;reviewerName:string|null;retainedAt:string};
export type FormsData=FormsIdentity&{company:Company;view:FormsView;forms:FormsForm[];counts:{total:number;draft:number;published:number;archived:number};catalogVersion:string;nextCursor:string|null;capabilities:{canManage:boolean};serverTime:string};
export type FormsFormData=FormsIdentity&{company:Company;form:FormsForm;schema:FormsField[];collectionVersion:string;serverTime:string}&({view:'mine';response:FormsResponse|null}|{view:'manage';assignees:FormsAssignee[]});
export type FormsRosterData=FormsIdentity&{users:FormsAssignee[];matchedCount:number;rosterVersion:string;nextCursor:string|null;serverTime:string};
export type FormsResponsesData=FormsIdentity&{form:FormsForm;responses:FormsResponseSummary[];counts:{total:number;reviewed:number;notReviewed:number};collectionVersion:string;nextCursor:string|null;serverTime:string};
export type FormsResponseData=FormsIdentity&{form:FormsForm;response:FormsResponse;history:FormsHistoryItem[];historyCount:number;collectionVersion:string;nextCursor:string|null;serverTime:string};
export type FormsQuery={tenantId:string;view:FormsView;status:'all'|FormsStatus;search:string;limit:number;cursor?:string};
export type FormsFormQuery={tenantId:string;formId:string;view:FormsView};
export type FormsRosterQuery={tenantId:string;search:string;limit:number;cursor?:string};
export type FormsResponsesQuery={tenantId:string;formId:string;status:'all'|'submitted';review:'all'|'reviewed'|'not_reviewed';search:string;limit:number;cursor?:string};
export type FormsResponseQuery={tenantId:string;formId:string;responseId:string;limit:number;cursor?:string};
export type FormsChange=
 |{action:'create_form';name:string;description:string;schema:FormsField[];audienceIds:string[];allowRespondentEdit:boolean}
 |{action:'edit_form';formId:string;formRevision:number;name:string;description:string;schema:FormsField[];allowRespondentEdit:boolean}
 |{action:'set_audience';formId:string;formRevision:number;audienceIds:string[]}
 |{action:'publish_form'|'archive_form'|'restore_form';formId:string;formRevision:number}
 |{action:'save_progress'|'submit_response'|'edit_response';formId:string;formRevision:number;responseRevision:number;answers:FormsAnswers}
 |{action:'admin_edit_response';formId:string;formRevision:number;responseId:string;responseRevision:number;answers:FormsAnswers}
 |{action:'review_response';formId:string;formRevision:number;responseId:string;responseRevision:number;reviewed:boolean};
export type FormsMutation={tenantId:string;operationId:string;change:FormsChange};
/** Revisions identify the original acknowledged write; an old receipt never changes current content. */
export type FormsSaved=FormsIdentity&{operationId:string;action:FormsChange['action'];formId:string;formRevision:number;responseId?:string;responseRevision?:number;responseStatus?:FormsResponseStatus;submittedAt?:string|null;updatedAt:string};
export type FormsReconcileQuery={tenantId:string;operationId:string;action:FormsChange['action']};
export type FormsReconciliation=FormsIdentity&{operationId:string;action:FormsChange['action'];status:'recorded'|'not_recorded';saved:FormsSaved|null};
