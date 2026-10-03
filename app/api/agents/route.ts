import { NextResponse } from 'next/server';
import { z } from 'zod';
import { configured, supabase } from '../../../lib/supabase';
import { validOrigin } from '../../../lib/request-security';

const record = {
  first_name: z.string().trim().min(1).max(100), last_name: z.string().trim().min(1).max(100),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/), title: z.string().max(100), team: z.string().max(100),
  employment_start_date: z.iso.date().nullable(), custom_fields: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().max(500)),
};
const change = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), ...record }).strict(),
  z.object({ action: z.literal('update'), id: z.uuid(), revision: z.number().int().positive(), ...record }).strict(),
  z.object({ action: z.enum(['archive','restore']), id: z.uuid(), revision: z.number().int().positive() }).strict(),
]);
const mutation = z.object({ tenantId: z.uuid(), changes: z.array(change).min(1).max(25) }).strict();
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  if (!configured()) return response({ error: 'Company sign-in is not configured yet.' }, 503);
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get('tenantId'));
  if (!id.success) return response({ error: 'Choose a company.' }, 400);
  const client = await supabase();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return response({ error: 'Sign in to continue.' }, 401);
  const { data: member, error: memberError } = await client.from('tenant_memberships').select('role').eq('tenant_id', id.data).eq('user_id', user.id).eq('status', 'active').maybeSingle();
  if (memberError) return response({ error: 'Company access could not be checked.' }, 503);
  if (!member || !['owner','admin','manager'].includes(member.role)) return response({ error: 'You do not have permission to view this directory.' }, 403);
  const { data, error: readError } = await client.from('agents').select('*').eq('tenant_id', id.data).order('last_name').order('first_name').limit(1000);
  const { data: members, error: directoryError } = await client.from('tenant_memberships').select('tenant_id,user_id,display_name,role,status').eq('tenant_id', id.data);
  return readError || directoryError ? response({ error: 'Agents could not be loaded.' }, 503) : response({ agents: data, members });
}

export async function POST(request: Request) {
  if (!validOrigin(request)) return response({ error: 'Invalid request origin.' }, 403);
  if (!configured()) return response({ error: 'Company sign-in is not configured yet.' }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 64000) return response({ error: 'Request is too large.' }, 413);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return response({ error: 'Invalid request.' }, 400); }
  const parsed = mutation.safeParse(data);
  if (!parsed.success) return response({ error: 'Complete the required names and mobile numbers. Use international phone format.' }, 400);
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return response({ error: 'Sign in to continue.' }, 401);
  const { data: result, error } = await client.rpc('save_agents', { target_tenant: parsed.data.tenantId, changes: parsed.data.changes });
  if (!error) return response({ saved: result });
  const messages: Record<string, string> = {
    '42501': 'You do not have permission for this action. Owners and your own access are protected.',
    'P0002': 'Agent not found.', '40001': 'This agent changed. Reload before saving.', '40P01': 'Another update is in progress. Reload and try again.',
    '23505': 'That mobile number already belongs to an agent in this company.',
    '22023': 'Complete all required fields for this company.', '23514': 'Enter valid names and a mobile number in international format.',
  };
  const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : ['40001','40P01','23505'].includes(error.code) ? 409 : ['22023','23514','23502','22007','22008'].includes(error.code) ? 400 : 503;
  return response({ error: messages[error.code] || 'The change could not be saved. Reload and try again.' }, status);
}
