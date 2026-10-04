import type {Member} from './agent-types';

export type KnowledgeFileMediaType='application/pdf'|'text/plain'|'text/csv'|'image/png'|'image/jpeg';
export type KnowledgeCurrentFile={versionId:string;filename:string;mediaType:KnowledgeFileMediaType;bytes:number;sha256:string;uploadedAt:string;uploaderName:string};
export type KnowledgeFileIdentity={tenantId:string;actorId:string;role:Member['role']};
export type KnowledgeFileCreate={tenantId:string;operationId:string;baseId:string;mode:'create';expectedBaseRevision:number;parentId:string;name:string;description:string;filename:string};
export type KnowledgeFileReplace={tenantId:string;operationId:string;baseId:string;mode:'replace';expectedBaseRevision:number;nodeId:string;expectedNodeRevision:number;name:string;description:string;filename:string};
export type KnowledgeFileMetadata=KnowledgeFileCreate|KnowledgeFileReplace;
export type KnowledgeFileAttemptStatus='not_recorded'|'upload_attempted'|'uploaded_unverified'|'provider_succeeded'|'finalized'|'closed'|'cleanup_acknowledged';
export type KnowledgeFileSaved=KnowledgeFileIdentity&{operationId:string;action:'save_file';baseId:string;nodeId:string;revision:number;nodeRevision:number;versionId:string};
/** Safe public recovery evidence. No filename, content, path, hash or provider proof. */
export type KnowledgeFileAttemptData=KnowledgeFileIdentity&{operationId:string;action:'save_file';status:KnowledgeFileAttemptStatus;attemptRevision:number|null;deadline:string|null;capabilities:{canFinalize:boolean;canClose:boolean;canCleanup:boolean};saved:KnowledgeFileSaved|null;serverTime:string};
export type KnowledgeFileBudgetData=KnowledgeFileIdentity&{allocatedBytes:number;allocatedAttempts:number;byteLimit:104857600;globalAttemptLimit:4096;companyAttemptLimit:2048;states:{upload_attempted:number;uploaded_unverified:number;provider_succeeded:number;finalized:number;closed:number;cleanup_acknowledged:number};serverTime:string};
export type KnowledgeFileOperation={tenantId:string;operationId:string};
export type KnowledgeFileAttemptChange=KnowledgeFileOperation&{expectedAttemptRevision:number};
/** Cleanup is a new management operation, bound to a closed original upload operation. */
export type KnowledgeFileCleanup={tenantId:string;operationId:string;uploadActorId:string;uploadOperationId:string;expectedAttemptRevision:number};
export type KnowledgeFileCleanupSaved=KnowledgeFileIdentity&{operationId:string;action:'cleanup_file';uploadOperationId:string;attemptRevision:number;status:'cleanup_acknowledged'};
export type KnowledgeFileSaveResponse={saved:KnowledgeFileSaved};
export type KnowledgeFileCleanupResponse={saved:KnowledgeFileCleanupSaved};
export type KnowledgeFileDownloadQuery={tenantId:string;baseId:string;nodeId:string;versionId:string};

export const KNOWLEDGE_FILE_MAX_BYTES=2097152;
export const KNOWLEDGE_FILE_MAX_MULTIPART_BYTES=2359296;
export const KNOWLEDGE_FILE_MAX_METADATA_BYTES=16384;
export const KNOWLEDGE_FILE_HEADERS={actor:'X-CT-Alt-Actor-ID',tenant:'X-CT-Alt-Company-ID',base:'X-CT-Alt-Knowledge-Base-ID',node:'X-CT-Alt-Knowledge-Node-ID',version:'X-CT-Alt-Knowledge-File-Version-ID'} as const;
