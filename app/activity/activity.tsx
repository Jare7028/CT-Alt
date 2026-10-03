'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Company, Member } from '../../lib/agent-types';
import type { ActivityAction, ActivityData, ActivityEvent } from '../../lib/overview-types';
import './activity.css';

type Props={company:Company;role:Member['role'];initialData:ActivityData};
type Filters={action:ActivityAction|'';startDate:string;endDate:string};
const blankFilters:Filters={action:'',startDate:'',endDate:''};
const actionNames:Record<ActivityAction,string>={created:'Created user',updated:'Updated user',archived:'Archived user',restored:'Restored user'};
export default function Activity(props:Props) {return <ActivityContent key={`${props.company.id}:${props.role}`} {...props}/>;}
function ActivityContent({company,role,initialData}:Props) {
 const [data,setData]=useState(initialData);const [filters,setFilters]=useState<Filters>(blankFilters);const [draft,setDraft]=useState<Filters>(blankFilters);
 const [loading,setLoading]=useState<'replace'|'older'|null>(null);const [error,setError]=useState('');
 const request=useRef<AbortController|null>(null);const version=useRef(0);
 useEffect(()=>()=>request.current?.abort(),[]);
 const allowed=role==='owner'||role==='admin';
 const formatTime=new Intl.DateTimeFormat('en-GB',{timeZone:data.timeZone ?? company.time_zone,dateStyle:'medium',timeStyle:'medium'});
 async function load(next:Filters,cursor:string|null=null) {
  if(!allowed)return;
  request.current?.abort();const controller=new AbortController();request.current=controller;const current=++version.current;
  setError('');setFilters(next);setLoading(cursor?'older':'replace');if(!cursor)setData({events:[],nextCursor:null});
  const query=new URLSearchParams({tenantId:company.id});if(next.action)query.set('action',next.action);if(next.startDate)query.set('startDate',next.startDate);if(next.endDate)query.set('endDate',next.endDate);if(cursor)query.set('cursor',cursor);
  try {
   const response=await fetch(`/api/activity?${query}`,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw new Error(response.status===403?'Your access has changed. Reload the page to review company access.':'Activity could not be loaded. Try refreshing.');
   const result=await response.json() as ActivityData;
   if(current===version.current && !controller.signal.aborted) setData(previous=>({events:cursor?appendUnique(previous.events,result.events):result.events,nextCursor:result.nextCursor,timeZone:result.timeZone}));
  } catch(cause) {
   if(current===version.current && !controller.signal.aborted){setData({events:[],nextCursor:null});setError(cause instanceof Error?cause.message:'Activity could not be loaded.');}
  } finally {if(current===version.current && !controller.signal.aborted)setLoading(null);}
 }
 function apply() {
  if(draft.startDate && draft.endDate && draft.startDate>draft.endDate){request.current?.abort();version.current++;setLoading(null);setData({events:[],nextCursor:null});setError('The end date must be on or after the start date.');return;}
  void load(draft);
 }
 if(!allowed)return <div className="activity-page"><div className="activity-heading"><h1>Activity</h1></div><div className="activity-empty">The activity log is available to company owners and admins.</div></div>;
 return <div className="activity-page">
  <div className="activity-heading"><div><h1>Activity</h1><p>Keep track of changes across your company</p></div><button onClick={()=>load(filters)} disabled={loading!==null}>{loading==='replace'?'Refreshing…':'Refresh activity'}</button></div>
  <section className="activity-card">
   <div className="activity-tabs" aria-label="Activity sections"><span>Activity log</span><span className="activity-future">Activity analytics <small>Coming soon</small></span></div>
   <div className="activity-filters"><label>Action<select aria-label="Action" value={draft.action} onChange={event=>setDraft({...draft,action:event.target.value as Filters['action']})}><option value="">All actions</option>{Object.entries(actionNames).map(([value,name])=><option value={value} key={value}>{name}</option>)}</select></label><label>Start date<input type="date" value={draft.startDate} onChange={event=>setDraft({...draft,startDate:event.target.value})}/></label><label>End date<input type="date" value={draft.endDate} onChange={event=>setDraft({...draft,endDate:event.target.value})}/></label><button className="activity-primary" onClick={apply}>Apply filters</button><button onClick={()=>{setDraft(blankFilters);void load(blankFilters);}} disabled={!draft.action&&!draft.startDate&&!draft.endDate&&!filters.action&&!filters.startDate&&!filters.endDate}>Clear filters</button></div>
   <div className="activity-context"><p>Recorded user changes · Dates and times in {data.timeZone ?? company.time_zone}</p><span>{data.events.length} {data.events.length===1?'event':'events'} loaded</span></div>
   {error?<p className="activity-error" role="alert">{error}</p>:null}
   <div aria-busy={loading!==null} className="activity-results">
    {loading==='replace'?<p role="status" className="activity-empty">Loading activity…</p>:data.events.length?<ol className="activity-log">{data.events.map(event=><li key={event.id}><span className={`activity-symbol activity-symbol-${event.action}`} aria-hidden="true">{event.action==='created'?'+':event.action==='archived'?'−':'↺'}</span><div className="activity-description"><span className="activity-tag">{actionNames[event.action]}</span><p><strong>{event.actor_name||'Unknown actor'}</strong> {event.action==='created'?'created':event.action==='archived'?'archived':event.action==='restored'?'restored':'updated'} <Link href={`/agents/${event.agent_id}?company=${company.id}`}>{event.agent_name||'User record'}</Link></p><small>Revision {event.revision} · Event {event.id}</small></div><time dateTime={event.occurred_at}>{formatTime.format(new Date(event.occurred_at))}</time></li>)}</ol>:!error?<div className="activity-empty"><strong>No activity to show</strong><p>{filters.action||filters.startDate||filters.endDate?'No user changes match these filters. Try another action or date range.':'User changes will appear here when they are recorded.'}</p></div>:null}
   </div>
   {data.nextCursor?<div className="activity-pagination"><button onClick={()=>load(filters,data.nextCursor)} disabled={loading!==null}>{loading==='older'?'Loading older activity…':'Load older activity'}</button></div>:data.events.length?<p className="activity-end">You’ve reached the oldest matching activity.</p>:null}
  </section>
 </div>;
}
function appendUnique(current:ActivityEvent[],next:ActivityEvent[]) {const ids=new Set(current.map(event=>event.id));return [...current,...next.filter(event=>!ids.has(event.id))];}
