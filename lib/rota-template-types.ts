export const ROTA_TEMPLATE_LIMITS = { perSchedule: 500, pageMax: 100, pageDefault: 30, requestBytes: 8192, companyShifts: 5000 } as const;
export type RotaTemplateAction = 'create' | 'edit' | 'duplicate' | 'delete' | 'apply';
export type RotaTemplateRecipe = { name: string; title: string; job_id: string; start_minute: number; end_minute: number; end_day_offset: number };
export type RotaTemplate = RotaTemplateRecipe & { id: string; tenant_id: string; schedule_id: string; revision: number };
export type RotaTemplateSchedule = { id: string; revision: number; time_zone: string; status: 'active' | 'archived' };
export type RotaTemplateQuery = { tenantId: string; scheduleId: string; q?: string; limit?: number; cursor?: string };
export type RotaTemplateData = { schemaVersion: 1; tenantId: string; actorId: string; schedule: RotaTemplateSchedule; templates: RotaTemplate[]; page: { total: number; nextCursor: string | null } };
type Base = { schedule_id: string; schedule_revision: number };
type Target = { template_id: string; template_revision: number };
export type RotaTemplateChange =
  | ({ action: 'create' } & Base & RotaTemplateRecipe)
  | ({ action: 'edit' } & Base & Target & RotaTemplateRecipe)
  | ({ action: 'duplicate'; name: string } & Base & Target)
  | ({ action: 'delete' } & Base & Target)
  | ({ action: 'apply'; agent_id: string; date: string; start_occurrence: '' | 'earlier' | 'later'; end_occurrence: '' | 'earlier' | 'later'; allow_overlap: boolean } & Base & Target);
export type RotaTemplateMutation = { tenantId: string; operationId: string; change: RotaTemplateChange };
export type RotaTemplateSaved = { schemaVersion: 1; tenantId: string; actorId: string; operationId: string; action: RotaTemplateAction; template_id: string; template_revision: number; schedule_id: string; schedule_revision: number; shift_id: string | null };
export type RotaTemplateRecoveryQuery = { mode: 'reconcile'; tenantId: string; operationId: string; action: RotaTemplateAction; scheduleId: string; templateId: string | null };
export type RotaTemplateReconciliation = { schemaVersion: 1; tenantId: string; actorId: string; operationId: string; action: RotaTemplateAction; scheduleId: string; templateId: string | null; status: 'recorded' | 'not_recorded'; saved: RotaTemplateSaved | null };
