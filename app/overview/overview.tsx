'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Company, Member } from '../../lib/agent-types';
import type { OverviewData } from '../../lib/overview-types';
import './overview.css';

type Props = { company: Company; role: Member['role']; initialData: OverviewData };
export default function Overview(props: Props) { return <OverviewContent key={`${props.company.id}:${props.role}`} {...props}/>; }
function OverviewContent({company,initialData}: Props) {
 const [data,setData]=useState<OverviewData|null>(initialData);
 const [loading,setLoading]=useState(false);const [error,setError]=useState('');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function refresh() {
  request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError('');
  try {
   const response=await fetch(`/api/overview?tenantId=${encodeURIComponent(company.id)}`,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw new Error(response.status===403?'Your access has changed. Reload the page to review company access.':'The overview could not be refreshed. Try again.');
   const next=await response.json() as OverviewData;
   if(!controller.signal.aborted && request.current===controller) {if(next.company.id!==company.id)throw new Error('The company summary could not be verified. Try again.');setData(next);}
  } catch(cause) { if(!controller.signal.aborted && request.current===controller){setData(null);setError(cause instanceof Error?cause.message:'The overview could not be refreshed.');} }
  finally {if(!controller.signal.aborted && request.current===controller)setLoading(false);}
 }
 const directory=`/agents?company=${company.id}`;const activity=`/activity?company=${company.id}`;
 const formatTime=new Intl.DateTimeFormat('en-GB',{timeZone:data?.company.time_zone ?? company.time_zone,dateStyle:'medium',timeStyle:'short'});
 return <div className="overview-page">
  <div className="overview-heading"><div><h1>Overview</h1><p>Your workforce at a glance</p></div><button onClick={refresh} disabled={loading}>{loading?'Refreshing…':'Refresh overview'}</button></div>
  {error?<p role="alert" className="overview-error">{error}</p>:null}
  <div aria-busy={loading}>
  {data?<>
   <div className="overview-metrics" aria-label="Workforce summary">
    {[['Active users',data.agents.active,'Current active directory records'],['Archived users',data.agents.archived,'Retained directory records'],['Linked accounts',data.agents.linked,'Active users with a linked account'],['Unlinked users',data.agents.unlinked,'Active users without a linked account']].map(([label,count,description])=><article className="overview-metric" key={label}><h2>{label}</h2><strong>{count.toLocaleString()}</strong><p>{description}</p></article>)}
   </div>
   <div className="overview-columns">
    <section className="overview-card"><div className="overview-card-heading"><h2>Workforce</h2><Link href={directory}>View users <span aria-hidden="true">›</span></Link></div><p className="overview-muted">Manage your directory and company access.</p>
     <div className="overview-linkage"><span>Account linkage</span><strong>{data.agents.linked} of {data.agents.active} active users</strong></div>
     <progress value={data.agents.linked} max={Math.max(1,data.agents.active)} aria-label="Active users with linked accounts"/>
     <p className="overview-caption">Linkage records whether an active directory user is connected to an account. Login and engagement activity is not recorded here.</p>
     <h3>Active company memberships</h3><dl className="overview-roles">{(['owner','admin','manager','employee'] as const).map(name=><div key={name}><dt>{name==='employee'?'Users':name==='owner'?'Owners':name==='admin'?'Admins':'Managers'}</dt><dd>{data.memberships[name]}</dd></div>)}</dl>
    </section>
    <section className="overview-card overview-quick"><div className="overview-card-heading"><h2>Quick actions</h2></div><Link className="overview-action" href={directory}><span aria-hidden="true">＋</span><div><strong>{data.role==='owner'||data.role==='admin'?'Manage users':'View users'}</strong><p>{data.role==='owner'||data.role==='admin'?'Add users, import a CSV, or edit your directory.':'Browse your company directory.'}</p></div><span aria-hidden="true">›</span></Link>
     {data.canViewActivity?<Link className="overview-action" href={activity}><span aria-hidden="true">↺</span><div><strong>Review activity</strong><p>Review recorded user changes and their authors.</p></div><span aria-hidden="true">›</span></Link>:null}
     <div className="overview-pending"><h3>More workforce insights</h3><p>Attendance, time off, engagement analytics and alerts will appear as those features become available.</p></div>
    </section>
   </div>
   {data.canViewActivity?<section className="overview-card overview-recent"><div className="overview-card-heading"><h2>Recent activity</h2><Link href={activity}>View activity <span aria-hidden="true">›</span></Link></div><p className="overview-muted">Recorded user changes · {data.company.time_zone}</p>{data.recentActivity.length?<ol>{data.recentActivity.map(event=><li key={event.id}><span className={`overview-event overview-event-${event.action}`} aria-hidden="true">{event.action==='created'?'+':event.action==='archived'?'−':'↺'}</span><div><p><strong>{event.actor_name||'Unknown actor'}</strong> {event.action==='created'?'created':event.action==='archived'?'archived':event.action==='restored'?'restored':'updated'} <Link href={`/agents/${event.agent_id}?company=${company.id}`}>{event.agent_name||'User record'}</Link></p><span>Revision {event.revision}</span></div><time dateTime={event.occurred_at}>{formatTime.format(new Date(event.occurred_at))}</time></li>)}</ol>:<div className="overview-empty">No user changes have been recorded yet.</div>}</section>:null}
  </>:!loading?<div className="overview-empty">The workforce summary is unavailable. Refresh to try again.</div>:null}
  </div>
 </div>;
}
