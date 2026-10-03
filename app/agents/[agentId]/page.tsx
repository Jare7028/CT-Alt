import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { configured, supabase } from '../../../lib/supabase';
import { formatEmploymentDate, formatTimestamp } from '../../../lib/agent-dates';
import type { Agent, AgentField, Member } from '../../../lib/agent-types';
import AppShell from '../../components/app-shell';
import '../users.css';
import './profile.css';
import EditDetails from './edit-details';

export const dynamic='force-dynamic';
export default async function AgentProfile({params,searchParams}:{params:Promise<{agentId:string}>;searchParams:Promise<{company?:string}>}) {
  if(!configured())redirect('/login');
  const [path,query]=await Promise.all([params,searchParams]);
  const id=z.uuid().safeParse(path.agentId),tenant=z.uuid().safeParse(query.company);
  if(!id.success || !tenant.success)notFound();
  const client=await supabase();
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError || !user)redirect('/login');
  const [companyResult,agentResult,actorResult,fieldsResult]=await Promise.all([
    client.from('tenants').select('id,name,time_zone').eq('id',tenant.data).maybeSingle(),
    client.from('agents').select('*').eq('tenant_id',tenant.data).eq('id',id.data).maybeSingle(),
    client.from('tenant_memberships').select('role,status').eq('tenant_id',tenant.data).eq('user_id',user.id).maybeSingle(),
    client.from('agent_fields').select('key,label,required,position').eq('tenant_id',tenant.data).order('position'),
  ]);
  if(companyResult.error || agentResult.error || actorResult.error || fieldsResult.error)return <main><h1>Agent details</h1><p role="alert">Agent details could not be loaded. Please try again shortly.</p></main>;
  const company=companyResult.data,agent=agentResult.data as Agent|null,actor=actorResult.data;
  if(!company || !agent || !actor || actor.status!=='active')notFound();
  const canReadDirectory=['owner','admin','manager'].includes(actor.role);
  if(!canReadDirectory && (actor.role!=='employee' || agent.user_id!==user.id || agent.status!=='active'))notFound();
  // PostgREST/RLS still authorizes every read; this page never grants access.
  const ids=[...new Set([agent.created_by,agent.user_id].filter((value):value is string=>!!value))];
  const {data:members,error:memberError}=await client.from('tenant_memberships').select('user_id,role,status,display_name').eq('tenant_id',company.id).in('user_id',ids);
  if(memberError)return <main><h1>Agent details</h1><p role="alert">Company access details could not be loaded. Please try again shortly.</p></main>;
  const linked=(members as Pick<Member,'user_id' | 'role' | 'status' | 'display_name'>[]).find(member=>member.user_id===agent.user_id);
  const addedBy=members?.find(member=>member.user_id===agent.created_by)?.display_name || 'Not available';
  const value=(text:string|null)=>text?.trim() ? text : 'Not provided';
  const basic=[['First name',agent.first_name],['Last name',agent.last_name],['Mobile phone',agent.phone]];
  const companyValues=[['Title',value(agent.title)],['Team',value(agent.team)],['Employment Start Date',agent.employment_start_date ? formatEmploymentDate(agent.employment_start_date) : 'Not provided']];
  const access=[['Directory status',agent.status==='archived'?'Archived':'Active'],['Account',agent.user_id?'Account linked':'No linked account'],['Company access',linked ? linked.status==='active'?'Active':'Suspended' : 'No linked membership'],['Access level',linked ? linked.role[0].toUpperCase()+linked.role.slice(1) : 'Not assigned']];
  return <AppShell moduleLinks={{'time-off':`/time-off?company=${encodeURIComponent(company.id)}`, 'quick-tasks':`/quick-tasks?company=${encodeURIComponent(company.id)}`, 'time-clock':`/time-clock?company=${encodeURIComponent(company.id)}`, overview:canReadDirectory?`/overview?company=${encodeURIComponent(company.id)}`:undefined,activity:['owner','admin'].includes(actor.role)?`/activity?company=${encodeURIComponent(company.id)}`:undefined,chat:`/chat?company=${encodeURIComponent(company.id)}`,rotas:`/rotas?company=${encodeURIComponent(company.id)}`}} activeModule="users" companyId={company.id} companyName={company.name} pageNavigation={canReadDirectory ? <Link className="profile-back" href={`/agents?company=${company.id}`}>Back to Users</Link> : <Link className="profile-back" href="/login">Sign-in options</Link>}><div className="users-app profile-app">
    <main className="profile-main"><header className="profile-heading"><span className="avatar" aria-hidden="true">{agent.first_name[0]}{agent.last_name[0]}</span><div><h1>{agent.first_name} {agent.last_name}</h1><p>Agent details · {company.name}</p></div><span className="profile-status">{agent.status==='archived'?'Archived':'Active'}</span></header>
      {['owner','admin'].includes(actor.role) && agent.status==='active' ? <EditDetails key={`${user.id}:${company.id}:${agent.id}`} agent={agent} fields={fieldsResult.data as AgentField[]} actorId={user.id}/> : <>
      <section className="profile-card" aria-labelledby="user-details"><h2 id="user-details">Personal details</h2><dl>{basic.map(([label,text])=><div key={label}><dt>{label}</dt><dd>{label==='Mobile phone'?<a href={`tel:${agent.phone}`}>{text}</a>:text}</dd></div>)}</dl></section>
      <section className="profile-card" aria-labelledby="company-fields"><h2 id="company-fields">Company related info</h2><dl>{companyValues.map(([label,text])=><div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}{(fieldsResult.data as AgentField[]).map(field=><div key={field.key}><dt>{field.label}</dt><dd>{value(typeof agent.custom_fields[field.key]==='string'?agent.custom_fields[field.key]:null)}</dd></div>)}</dl></section></>}
      <section className="profile-card" aria-labelledby="company-access"><h2 id="company-access">Company access</h2><dl>{access.map(([label,text])=><div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl><p>These details describe this company only. {canReadDirectory?'Owners and admins can edit supported user details from the Users directory.':'Your role allows viewing your own active record.'}</p></section>
      <section className="profile-card" aria-labelledby="record-history"><h2 id="record-history">Record information</h2><dl>{[['Date added',formatTimestamp(agent.created_at,company.time_zone)],['Last updated',formatTimestamp(agent.updated_at,company.time_zone)],['Added by',addedBy]].map(([label,text])=><div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl><p>Record dates use {company.time_zone}. Employment Start Date remains a calendar date.</p></section>
    </main>
  </div></AppShell>;
}
