export const ROTA_PUBLICATION_LIMITS = { requestBytes: 512 * 1024, shifts: 5000 } as const;
export type RotaPublicationShift = { id: string; revision: number };
export type RotaPublicationMutation = {
  tenantId: string;
  scheduleId: string;
  scheduleRevision: number;
  shifts: RotaPublicationShift[];
};
export type RotaPublicationSaved = {
  schemaVersion: 1;
  tenantId: string;
  actorId: string;
  schedule_id: string;
  schedule_revision: number;
  published_count: number;
  shifts: RotaPublicationShift[];
};
