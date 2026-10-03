import Link from 'next/link';
import { redirect } from 'next/navigation';
import { configured, supabase } from '../../lib/supabase';
import type { Agent, AgentField, Company, Member } from '../../lib/agent-types';
import Users from './users';
import DashboardShell from '../components/dashboard-shell';

export const dynamic = 'force-dynamic';

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  if (!configured()) redirect('/login');
  const client = await supabase();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect('/login');
  const { data: companies, error: companyError } = await client.from('tenants').select('id,name,time_zone').order('name');
  if (companyError) return <main><h1>Users</h1><p role="alert">Company access could not be loaded. Please try again shortly.</p></main>;
  const requested = (await searchParams).company;
  const company = companies?.find(item => item.id === requested) || (!requested ? companies?.[0] : null);
  if (!company) return <main><h1>{requested?'Company access unavailable':'Company activation pending'}</h1><p>{requested?'Your account has no active access to this company.':'Your email is confirmed. An administrator needs to activate your company access.'}</p><Link href="/agents">Check company access again</Link><p><Link href="/login">Return to sign-in</Link></p></main>;
  const [membersResult, agentsResult, fieldsResult] = await Promise.all([
    client.from('tenant_memberships').select('tenant_id,user_id,display_name,role,status').eq('tenant_id', company.id),
    client.from('agents').select('*').eq('tenant_id', company.id).order('last_name').order('first_name').limit(1000),
    client.from('agent_fields').select('key,label,required,position').eq('tenant_id', company.id).order('position'),
  ]);
  if (membersResult.error || agentsResult.error || fieldsResult.error) return <main><h1>Users</h1><p role="alert">The directory could not be loaded. Please try again shortly.</p></main>;
  const members = membersResult.data as Member[];
  const member = members.find(item => item.user_id === user.id);
  if (!member) return <main><h1>Users</h1><p>Company access unavailable.</p></main>;
  if (member.role === 'employee') return <DashboardShell company={company as Company} companies={companies as Company[]} role={member.role} module="time-clock"><h1>Your workday</h1><p>Your role does not include company directory access.</p><p><Link href={`/time-clock?company=${encodeURIComponent(company.id)}`}>Open my Time Clock</Link> · <Link href={`/quick-tasks?company=${encodeURIComponent(company.id)}`}>Open my Quick Tasks</Link> · <Link href={`/rotas?company=${encodeURIComponent(company.id)}`}>Client Rotas</Link> · <Link href={`/chat?company=${encodeURIComponent(company.id)}`}>Company Chat</Link></p></DashboardShell>;
  return <Users key={company.id} companies={companies as Company[]} company={company as Company} members={members} agents={agentsResult.data as Agent[]} fields={fieldsResult.data as AgentField[]} actorId={user.id} canManage={member.role === 'owner' || member.role === 'admin'} />;
}
