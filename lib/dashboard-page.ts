import 'server-only';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { configured, supabase } from './supabase';
import type { Company } from './agent-types';
import { OverviewReadError } from './workforce-overview';

export async function dashboardPageCompany(requested: string | string[] | undefined) {
  if (!configured()) redirect('/login');
  const client = await supabase();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect('/login');
  if (requested !== undefined && !z.uuid().safeParse(requested).success) throw new OverviewReadError('Company access unavailable.', 400);
  const result = await client.from('tenants').select('id,name,time_zone').eq('status', 'active').order('name');
  if (result.error) throw new OverviewReadError('Company access could not be loaded.');
  const companies = result.data as Company[];
  const company = requested ? companies.find(item => item.id === requested) : companies[0];
  if (!company) throw new OverviewReadError('Company access unavailable.', 403);
  return { client, companies, company };
}
