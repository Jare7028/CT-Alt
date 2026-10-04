import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formsParseJSON } from './forms';
import { ROTA_PUBLICATION_LIMITS as L, type RotaPublicationMutation, type RotaPublicationSaved } from './rota-publication-types';

export class RotaPublicationError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
const uuid = z.uuid().transform(v => v.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const target = z.object({ id: uuid, revision: revision.max(2147483646) }).strict();
export const rotaPublicationMutation: z.ZodType<RotaPublicationMutation> = z.object({
  tenantId: uuid, scheduleId: uuid, scheduleRevision: revision.max(2147483646),
  shifts: z.array(target).min(1).max(L.shifts),
}).strict().refine(v => new Set(v.shifts.map(s => s.id)).size === v.shifts.length);
const saved = z.object({
  schemaVersion: z.literal(1), tenantId: uuid, actorId: uuid, schedule_id: uuid,
  schedule_revision: revision, published_count: z.number().int().min(1).max(L.shifts),
  shifts: z.array(z.object({ id: uuid, revision }).strict()).min(1).max(L.shifts),
}).strict();
const access = z.object({
  schemaVersion: z.literal(1), tenantId: uuid, actorId: uuid,
  schedule: z.object({ id: uuid, revision, time_zone: z.string().min(1).max(100), status: z.enum(['active', 'archived']) }).strict(),
}).strict();
function invalid(): never { throw new RotaPublicationError('Publication acknowledgement could not be verified. Reload schedules and review.'); }
function fail(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === '42501') throw new RotaPublicationError('Current schedule access is unavailable.', 403);
  if (['40001', '40P01'].includes(error.code || '')) throw new RotaPublicationError('Selected shifts or schedule changed. Reload and review before publishing.', 409);
  if (error.code?.startsWith('22') || ['23503', '23514'].includes(error.code || '')) throw new RotaPublicationError('Choose current draft shifts with active assigned workers.', 400);
  throw new RotaPublicationError('Publication could not be confirmed. Reload schedules and review.');
}
async function signed(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new RotaPublicationError('Sign in to publish shifts.', 401);
  if (data.user.is_anonymous) throw new RotaPublicationError('Current account cannot publish shifts.', 403);
  return data.user.id.toLowerCase();
}
export async function publishRotaShifts(client: SupabaseClient, value: unknown): Promise<RotaPublicationSaved> {
  const parsed = rotaPublicationMutation.safeParse(value);
  if (!parsed.success) throw new RotaPublicationError('Choose a nonempty unique selection of current draft shifts.', 400);
  const v = parsed.data, actor = await signed(client);
  const { data, error } = await client.rpc('publish_rota_shifts', {
    target_tenant: v.tenantId, target_schedule: v.scheduleId, expected_revision: v.scheduleRevision, shift_rows: v.shifts,
  });
  fail(error);
  const checked = saved.safeParse(data);
  if (!checked.success) invalid();
  const result = checked.data, targets = new Map(v.shifts.map(s => [s.id, s.revision]));
  if (result.tenantId !== v.tenantId || result.actorId !== actor || result.schedule_id !== v.scheduleId ||
    result.schedule_revision !== v.scheduleRevision + 1 || result.published_count !== targets.size ||
    result.shifts.length !== targets.size || new Set(result.shifts.map(s => s.id)).size !== targets.size ||
    result.shifts.some(s => !targets.has(s.id) || s.revision !== targets.get(s.id)! + 1)) invalid();
  // A successful mutation can race a later authorized write. Verify current access,
  // not equality to the acknowledged revision; never retry an uncertain mutation.
  if (await signed(client) !== actor) throw new RotaPublicationError('Current account changed. Reload and review.', 403);
  const current = await client.rpc('read_rota_template_access', { target_tenant: v.tenantId, target_schedule: v.scheduleId });
  fail(current.error);
  const currentAccess = access.safeParse(current.data);
  if (!currentAccess.success || currentAccess.data.tenantId !== v.tenantId || currentAccess.data.actorId !== actor ||
    currentAccess.data.schedule.id !== v.scheduleId || currentAccess.data.schedule.revision < result.schedule_revision) invalid();
  return result;
}
export async function readRotaPublicationBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > L.requestBytes)) throw new RotaPublicationError('Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RotaPublicationError('Choose draft shifts to publish.', 400);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > L.requestBytes) { await reader.cancel(); throw new RotaPublicationError('Request is too large.', 413); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { raw.set(part, offset); offset += part.length; }
  try { return formsParseJSON(new TextDecoder('utf8', { fatal: true }).decode(raw), L.requestBytes); }
  catch { throw new RotaPublicationError('Choose valid UTF8 publication details without duplicate fields.', 400); }
}
