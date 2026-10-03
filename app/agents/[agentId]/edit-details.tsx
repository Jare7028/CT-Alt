'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { formatEmploymentDate } from '../../../lib/agent-dates';
import type { Agent, AgentField, AgentInput } from '../../../lib/agent-types';

type Field={key:string;label:string;required?:boolean;type?:'tel'|'date';max:number};
type Edit={key:string;value:string};
const initial=(agent:Agent):AgentInput=>({first_name:agent.first_name,last_name:agent.last_name,phone:agent.phone,title:agent.title,team:agent.team,employment_start_date:agent.employment_start_date,custom_fields:{...agent.custom_fields}});
function fieldValue(record:AgentInput,key:string) {return key.startsWith('custom:')?record.custom_fields[key.slice(7)] || '':String(record[key as Exclude<keyof AgentInput,'custom_fields'>] || '');}
function changed(record:AgentInput,edit:Edit) {return fieldValue(record,edit.key)!==edit.value;}
function patch(record:AgentInput,edit:Edit):AgentInput {
  if(edit.key.startsWith('custom:'))return {...record,custom_fields:{...record.custom_fields,[edit.key.slice(7)]:edit.value}};
  return {...record,[edit.key]:['first_name','last_name','phone'].includes(edit.key)?edit.value.trim():edit.key==='employment_start_date'?edit.value || null:edit.value};
}
function valid(record:AgentInput,fields:AgentField[]) {
  if(!record.first_name.trim() || !record.last_name.trim() || record.first_name.length>100 || record.last_name.length>100)return 'Enter first and last names (maximum 100 characters).';
  if(!/^\+[1-9][0-9]{7,14}$/.test(record.phone))return 'Use a mobile number in full international format, including + and country code.';
  if(record.title.length>100 || record.team.length>100 || Object.values(record.custom_fields).some(value=>value.length>500))return 'This value is too long.';
  if(record.employment_start_date && formatEmploymentDate(record.employment_start_date)==='Invalid date')return 'Enter a valid calendar date in years 0001–9999.';
  if(fields.some(field=>field.required && !record.custom_fields[field.key]?.trim()))return 'Complete all required company fields before saving.';
  return '';
}
const subscribeRecovery=()=>()=>{};
function recoveryMessage(key:string,currentRevision:number) {
  try {const raw=sessionStorage.getItem(key);if(!raw)return null;const previous=JSON.parse(raw);if(previous.status==='saved' && Number.isInteger(previous.revision) && previous.revision>0 && currentRevision>=previous.revision)return null;return previous.status==='saved'?'Changes were saved on an earlier visit. Reload the latest details before editing.':'An earlier save outcome was not confirmed here. Reload and review the latest details before editing.';}catch{return null;}
}
export default function EditDetails({agent,fields,actorId}:{agent:Agent;fields:AgentField[];actorId:string}) {
  const router=useRouter();
  const [record,setRecord]=useState(()=>initial(agent)),[edit,setEdit]=useState<Edit|null>(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[blocked,setBlocked]=useState(false),[destination,setDestination]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const confirmed=useRef(record),revision=useRef(agent.revision),editing=useRef<Edit|null>(null),inFlight=useRef(false),locked=useRef(false),mounted=useRef(true),nextField=useRef<string|null>(null),leaving=useRef<string|null>(null),allowExit=useRef(false),hasSaved=useRef(false);
  const input=useRef<HTMLInputElement>(null),alert=useRef<HTMLParagraphElement>(null),focusField=useRef<string|null>(null),buttons=useRef(new Map<string,HTMLButtonElement>());
  const storageKey=`ct-alt:profile-outcome:v1:${actorId}:${agent.tenant_id}:${agent.id}`;
  const ownMarker=useRef(false);
  const recovery=useSyncExternalStore(subscribeRecovery,()=>ownMarker.current?null:recoveryMessage(storageKey,agent.revision),()=>null);
  function isLocked() {return locked.current || !ownMarker.current && !!recoveryMessage(storageKey,agent.revision);}
  const personal:Field[]=[{key:'first_name',label:'First name',required:true,max:100},{key:'last_name',label:'Last name',required:true,max:100},{key:'phone',label:'Mobile phone',type:'tel',required:true,max:16}];
  const company:Field[]=[{key:'title',label:'Title',max:100},{key:'team',label:'Team',max:100},{key:'employment_start_date',label:'Employment Start Date',type:'date',max:10},...fields.map(field=>({key:'custom:'+field.key,label:field.label,required:field.required,max:500}))];
  function marker(value:'pending'|'unknown'|'saved'|null) {ownMarker.current=true;try{if(value)sessionStorage.setItem(storageKey,JSON.stringify({status:value,revision:revision.current}));else sessionStorage.removeItem(storageKey);}catch{/* Storage is optional; authorization and revision checks remain server-side. */}}
  function focus() {requestAnimationFrame(()=>{if(isLocked())alert.current?.focus();else input.current?.focus();});}
  function fail(message:string,stop=false) {if(stop){locked.current=true;marker('unknown');}if(mounted.current){setError(message);setStatus('Not saved.');setBlocked(stop);focus();}}
  function navigate(href:string) {allowExit.current=true;if(hasSaved.current)marker('saved');const url=new URL(href,location.href);if(url.origin===location.origin)router.push(url.pathname+url.search+url.hash);else location.assign(url.href);}
  function begin(key:string) {
    if(inFlight.current){nextField.current=key;return;}
    if(isLocked()){focus();return;}
    if(editing.current && changed(confirmed.current,editing.current)){focus();return;}
    const next={key,value:fieldValue(confirmed.current,key)};editing.current=next;setEdit(next);setError('');setStatus('');
  }
  function cancel() {
    if(inFlight.current || isLocked())return;
    const key=editing.current?.key;editing.current=null;setEdit(null);setError('');setStatus('Unsaved edit discarded.');focusField.current=key || null;
  }
  async function save() {
    const current=editing.current;if(!current || inFlight.current || isLocked())return;
    if(!changed(confirmed.current,current)){editing.current=null;setEdit(null);setStatus('No changes.');setError('');return;}
    if(input.current && !input.current.validity.valid){fail(`Enter a valid ${input.current.getAttribute('aria-label') || 'field value'}.`);return;}
    const snapshot=patch(confirmed.current,current),validation=valid(snapshot,fields);
    if(validation){fail(validation);return;}
    if(fieldValue(snapshot,current.key)===fieldValue(confirmed.current,current.key)){editing.current=null;setEdit(null);setStatus('No changes.');setError('');return;}
    const expected=revision.current;inFlight.current=true;marker('pending');setBusy(true);setError('');setStatus('Saving…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch('/api/agents',{method:'POST',keepalive:true,signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:agent.tenant_id,changes:[{action:'update',id:agent.id,revision:expected,...snapshot}]})});
      const data=await response.json();
      if(!response.ok) {
        if(response.status>=500){fail('The save outcome is unknown. Reload the latest details before editing again.',true);return;}
        const message=typeof data.error==='string'?data.error:'The change was rejected. Review this field.';
        const stop=[401,403,404].includes(response.status) || response.status===409 && /changed|in progress/.test(message);
        if(!stop)marker(null);fail(message,stop);return;
      }
      if(!Array.isArray(data.saved) || data.saved.length!==1 || data.saved[0]?.id!==agent.id || data.saved[0]?.revision!==expected+1){fail('The save outcome is unknown. Reload the latest details before editing again.',true);return;}
      confirmed.current=snapshot;revision.current=expected+1;hasSaved.current=true;marker('saved');editing.current=null;
      if(mounted.current){setRecord(snapshot);setEdit(null);setStatus('Saved.');setError('');focusField.current=current.key;router.refresh();}
    } catch {fail('The save outcome is unknown. Reload the latest details before editing again.',true);}
    finally {
      clearTimeout(timer);inFlight.current=false;
      if(mounted.current){setBusy(false);if(!editing.current && !isLocked()){const href=leaving.current;leaving.current=null;if(href){navigate(href);}else if(nextField.current){const key=nextField.current;nextField.current=null;begin(key);}}}
    }
  }
  function exit(href:string) {
    if(!inFlight.current && !isLocked() && (!editing.current || !changed(confirmed.current,editing.current)))return false;
    leaving.current=href;setDestination(href);if(!inFlight.current)void save();return true;
  }
  const handlers=useRef({save,exit});
  useEffect(()=>{handlers.current={save,exit};});
  useEffect(()=>{
    mounted.current=true;

    const click=(event:MouseEvent)=>{const link=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null;if(!link || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target==='_blank' || link.hasAttribute('download') || allowExit.current)return;if(handlers.current.exit(link.href))event.preventDefault();};
    const departure=()=>{if(allowExit.current)return;if(editing.current && changed(confirmed.current,editing.current))void handlers.current.save();if(inFlight.current)marker('pending');else if(hasSaved.current)marker('saved');};
    const unload=(event:BeforeUnloadEvent)=>{if(allowExit.current)return;departure();if(inFlight.current || isLocked() || editing.current && changed(confirmed.current,editing.current)){event.preventDefault();event.returnValue='';}};
    const navigation=(event:Event)=>{const move=event as Event & {navigationType?:string};if(move.navigationType==='traverse')departure();};
    const navigationApi=(window as Window & {navigation?:EventTarget}).navigation;
    document.addEventListener('click',click,true);window.addEventListener('beforeunload',unload);window.addEventListener('popstate',departure);navigationApi?.addEventListener('navigate',navigation);
    return ()=>{mounted.current=false;document.removeEventListener('click',click,true);window.removeEventListener('beforeunload',unload);window.removeEventListener('popstate',departure);navigationApi?.removeEventListener('navigate',navigation);};
    // The component is keyed by actor/company/record. Handlers use current refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storageKey]);
  const editKey=edit?.key || null;
  useEffect(()=>{if(editKey)input.current?.focus();else if(focusField.current){if(document.activeElement===document.body)buttons.current.get(focusField.current)?.focus();focusField.current=null;}},[editKey]);
  function reload() {allowExit.current=true;marker(null);location.reload();}
  function renderFields(items:Field[]) {return <dl>{items.map(field=><div key={field.key}><dt>{field.label}{field.required?' *':''}</dt><dd>{edit?.key===field.key ? <input ref={input} aria-label={field.label} type={field.type || 'text'} value={edit.value} maxLength={field.max} min={field.type==='date'?'0001-01-01':undefined} max={field.type==='date'?'9999-12-31':undefined} required={field.required} disabled={busy || blocked || !!recovery} onChange={event=>{const next={key:field.key,value:event.target.value};editing.current=next;setEdit(next);setError('');setStatus('Editing…');}} onBlur={()=>void save()} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();cancel();}else if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/> : <button className="profile-field-value" ref={node=>{if(node)buttons.current.set(field.key,node);else buttons.current.delete(field.key);}} aria-label={`Edit ${field.label}`} disabled={blocked || !!recovery} onClick={()=>begin(field.key)}>{field.key==='employment_start_date' && record.employment_start_date?formatEmploymentDate(record.employment_start_date):fieldValue(record,field.key) || 'Not provided'}</button>}</dd></div>)}</dl>;}
  return <div className="profile-editor">
    <p className="profile-edit-help">Click a field to edit. Changes save when you leave the field. Press Escape to discard an unsaved edit.</p>
    {status ? <p role="status" className="profile-save-status">{busy || edit && changed(record,edit) && !blocked && !recovery?<span className="profile-saving-dot" aria-hidden="true"/>:null}{status}</p> : null}
    {error || recovery ? <p ref={alert} tabIndex={-1} role="alert" className="error">{error || recovery}</p> : null}
    {blocked || recovery ? <button onClick={reload} disabled={busy}>Reload latest details</button> : null}
    {destination ? <div className="profile-navigation-notice" role="region" aria-label="Pending navigation"><p>{busy?'Waiting for this save before leaving…':'This edit is not confirmed. Stay to fix it or leave without saving further changes. Leaving does not undo changes already saved.'}</p><button onClick={()=>{leaving.current=null;setDestination(null);focus();}}>Stay on profile</button>{!busy ? <button onClick={()=>navigate(destination)}>Leave without further changes</button> : null}</div> : null}
    <section className="profile-card" aria-labelledby="user-details"><h2 id="user-details">Personal details</h2>{renderFields(personal)}</section>
    <section className="profile-card" aria-labelledby="company-fields"><h2 id="company-fields">Company related info</h2>{renderFields(company)}</section>
  </div>;
}
