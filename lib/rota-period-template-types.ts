export const ROTA_PERIOD_LIMITS = { entries: 5000, metadataPerSchedule: 500, companyEntries: 20000, companyOperations: 20000, companyGenerated: 20000, companyShifts: 5000, pageMax: 100, pageDefault: 30, requestBytes: 524288, responseBytes: 1048576, clockMicros: 86399999999, elapsedMicros: 432000000000000 } as const;
export type RotaPeriodKind = 'day' | 'week';
export type RotaPeriodAction = 'save' | 'rename' | 'delete' | 'add';
export type RotaPeriodFilters = { jobId: string | null; status: 'all' | 'draft' | 'published'; workerSearch: string };
export type RotaPeriodSelector = { id: string; revision: number };
export type RotaPeriodOccurrence = { index: number; start?: 'earlier' | 'later'; end?: 'earlier' | 'later' };
export type RotaPeriodSchedule = { id: string; revision: number; time_zone: string; status: 'active' | 'archived' };
export type RotaPeriodCatalogueQuery = { tenantId: string; scheduleId: string; kind: RotaPeriodKind; q?: string; limit?: number; cursor?: string };
export type RotaPeriodHistoricalQuery = { mode: 'history'; tenantId: string; scheduleId: string; templateId: string; templateRevision: number; limit?: number; cursor?: string };
export type RotaPeriodSourcePreviewQuery = { mode: 'source-preview'; tenantId: string; scheduleId: string; scheduleRevision: number; kind: RotaPeriodKind; sourceAnchor: string; sourceFilters: RotaPeriodFilters; limit?: number; cursor?: string };
export type RotaPeriodPageKind = 'entries' | 'blocked' | 'affected' | 'visibleCommitments';
export type RotaPeriodTargetPreviewQuery = { mode: 'preview'; tenantId: string; scheduleId: string; scheduleRevision: number; templateId: string; templateRevision: number; targetAnchor: string; occurrences: RotaPeriodOccurrence[]; pageKind: RotaPeriodPageKind; limit?: number; cursor?: string };
type ScheduleTarget = { schedule_id: string; schedule_revision: number };
type TemplateTarget = { template_id: string; template_revision: number };
export type RotaPeriodChange =
 | (ScheduleTarget & { action: 'save'; kind: RotaPeriodKind; title: string; source_anchor: string; source_zone: string; source_filters: RotaPeriodFilters; source_review_digest: string; sources: RotaPeriodSelector[] })
 | (ScheduleTarget & TemplateTarget & { action: 'rename'; title: string })
 | (ScheduleTarget & TemplateTarget & { action: 'delete' })
 | (ScheduleTarget & TemplateTarget & { action: 'add'; target_anchor: string; occurrences: RotaPeriodOccurrence[]; plan_digest: string; expected_entry_count: number; allow_overlap: boolean });
export type RotaPeriodMutation = { tenantId: string; operationId: string; change: RotaPeriodChange };
export type RotaPeriodRecoveryQuery = { mode: 'reconcile'; tenantId: string; operationId: string; action: RotaPeriodAction; scheduleId: string; templateId: string | null };
export type RotaPeriodMetadata = { id: string; tenant_id: string; schedule_id: string; kind: RotaPeriodKind; title: string; source_anchor: string; source_zone: string; source_schedule_revision: number; source_filters: RotaPeriodFilters; entry_count: number; user_count: number; elapsed_micros: number; revision: number; created_at: string; updated_at: string };
export type RotaPeriodEntry = { index: number; source_shift_id: string; source_revision: number; source_status: 'draft' | 'published'; source_starts_at: string; source_ends_at: string; agent_id: string; agent_name: string; job_id: string; job_name: string; job_color: string; title: string; start_day_offset: number; end_day_offset: number; start_clock_micros: number; end_clock_micros: number };
export type RotaPeriodAvailability = { workerAvailable: boolean; jobAvailable: boolean; currentAgentName: string | null; currentJobName: string | null; currentJobColor: string | null };
export type RotaPeriodHistoricalEntry = { entry: RotaPeriodEntry; availability: RotaPeriodAvailability };
export type RotaPeriodPage = { total: number; nextCursor: string | null };
type Envelope = { schemaVersion: 1; tenantId: string; actorId: string; schedule: RotaPeriodSchedule };
export type RotaPeriodCatalogueData = Envelope & { kind: RotaPeriodKind; q: string; capacity: RotaPeriodCapacity; canEdit: boolean; editBlockers: ('schedule_archived' | 'operation_capacity')[]; templates: RotaPeriodMetadata[]; page: RotaPeriodPage };
export type RotaPeriodHistoricalData = Envelope & { template: RotaPeriodMetadata; historyDigest: string; entries: RotaPeriodHistoricalEntry[]; page: RotaPeriodPage };
export type RotaPeriodSourceScope = { kind: RotaPeriodKind; anchor: string; zone: string; filters: RotaPeriodFilters; entryCount: number; userCount: number; elapsedMicros: number };
export type RotaPeriodSourcePreview = Envelope & { source: RotaPeriodSourceScope; capacity: RotaPeriodCapacity; canSave: boolean; saveBlockers: ('schedule_archived' | 'metadata_capacity' | 'entry_capacity' | 'operation_capacity')[]; sourceReviewDigest: string; entries: RotaPeriodEntry[]; page: RotaPeriodPage } & ({ firstPage: true; selectors: RotaPeriodSelector[] } | { firstPage: false; selectors?: never });
export type RotaPeriodEntryBlocker = 'worker_unavailable' | 'job_unavailable' | 'start_gap' | 'end_gap' | 'start_ambiguous' | 'end_ambiguous' | 'start_occurrence' | 'end_occurrence' | 'unsupported_endpoint' | 'invalid_duration';
export type RotaPeriodTargetEntry = RotaPeriodHistoricalEntry & { starts_at: string | null; ends_at: string | null; elapsed_micros: number | null; blockers: RotaPeriodEntryBlocker[]; internalConflict: boolean; existingConflict: boolean };
export type RotaPeriodVisibleCommitment = { id: string; revision: number; schedule_id: string; agent_id: string; agent_name: string; job_id: string; job_name: string; job_color: string; title: string; starts_at: string; ends_at: string; status: 'draft' | 'published' };
export type RotaPeriodCapacity = { metadata: number } & ({ companyUsageVisible: true; shifts: number; entries: number; operations: number; generated: number } | { companyUsageVisible: false; shifts: null; entries: null; operations: null; generated: null });
export type RotaPeriodPlanBlocker = 'schedule_archived' | 'shift_capacity' | 'operation_capacity' | 'generated_capacity';
export type RotaPeriodTargetPreview = Envelope & { template: RotaPeriodMetadata; targetAnchor: string; occurrences: RotaPeriodOccurrence[]; planDigest: string; canAdd: boolean; entryCount: number; userCount: number; elapsedMicros: number; blockedEntryCount: number; affectedEntryCount: number; visibleCommitmentCount: number; hasHiddenConflicts: boolean; capacity: RotaPeriodCapacity; blockers: RotaPeriodPlanBlocker[]; page: RotaPeriodPage } & ({ pageKind: 'entries' | 'blocked' | 'affected'; entries: RotaPeriodTargetEntry[]; commitments?: never } | { pageKind: 'visibleCommitments'; commitments: RotaPeriodVisibleCommitment[]; entries?: never });
export type RotaPeriodSaved = { schemaVersion: 1; tenantId: string; actorId: string; operationId: string; action: RotaPeriodAction; template_id: string; template_revision: number; schedule_id: string; schedule_revision: number; entry_count: number; generated: { index: number; id: string; revision: 1 }[]; plan_digest: string | null };
export type RotaPeriodReconciliation = { schemaVersion: 1; tenantId: string; actorId: string; operationId: string; action: RotaPeriodAction; scheduleId: string; templateId: string | null } & ({ status: 'recorded'; saved: RotaPeriodSaved } | { status: 'not_recorded'; saved: null });
