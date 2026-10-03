'use client';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Agent, AgentField, AgentInput } from '../../../lib/agent-types';

export default function EditDetails({agent,fields}:{agent:Agent;fields:AgentField[]}) {
  const router=useRouter(),button=useRef<HTMLButtonElement>(null);
  const [editing,setEditing]=useState(false),[notice,setNotice]=useState('');
  const [refreshing,startRefresh]=useTransition();
  function finish(saved=false,reload=false) {
    setEditing(false);setNotice(saved?'User details saved.':'');button.current?.focus();
    if(saved || reload)startRefresh(()=>router.refresh());
  }
  return <div className="profile-editor"><button ref={button} disabled={refreshing} className="primary" onClick={()=>{setNotice('');setEditing(true);}}>Edit user details</button>{refreshing ? <p role="status">Loading latest details…</p> : notice ? <p role="status">{notice}</p> : null}{editing ? <EditForm agent={agent} fields={fields} onClose={finish}/> : null}</div>;
}

function EditForm({agent,fields,onClose}:{agent:Agent;fields:AgentField[];onClose:(saved?:boolean,reload?:boolean)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  // Preserve the revision that produced this draft, even if the parent refreshes.
  const [original]=useState(agent);
  const [draft,setDraft]=useState<AgentInput>({first_name:agent.first_name,last_name:agent.last_name,phone:agent.phone,title:agent.title,team:agent.team,employment_start_date:agent.employment_start_date,custom_fields:{...agent.custom_fields}});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[blocked,setBlocked]=useState<'conflict'|'unknown'|null>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  function update(key:Exclude<keyof AgentInput,'custom_fields'>,value:string) {setDraft(current=>({...current,[key]:key==='employment_start_date'?value || null:value}));}
  function unknown() {setError('The save outcome could not be confirmed. Check the latest details before trying again.');setBlocked('unknown');}
  async function save(event:FormEvent) {
    event.preventDefault();if(busy || blocked)return;setBusy(true);setError('');
    try {
      const response=await fetch('/api/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:original.tenant_id,changes:[{action:'update',id:original.id,revision:original.revision,...draft,first_name:draft.first_name.trim(),last_name:draft.last_name.trim(),phone:draft.phone.trim()}]})});
      const data=await response.json();
      if(!response.ok) {
        if(response.status>=500){unknown();return;}
        const message=typeof data.error==='string'?data.error:'The change was rejected. Review your details.';
        setError(message);
        if(response.status===409 && /changed|in progress/.test(message))setBlocked('conflict');
        return;
      }
      if(!Array.isArray(data.saved) || data.saved.length!==1 || data.saved[0]?.id!==original.id || data.saved[0]?.revision!==original.revision+1){unknown();return;}
      onClose(true);
    } catch {unknown();}
    finally {setBusy(false);}
  }
  return <dialog ref={dialog} className="profile-edit-dialog" aria-labelledby="edit-user-title" onCancel={event=>{event.preventDefault();if(!busy)onClose(false,!!blocked);}}><form onSubmit={save}>
    <h2 id="edit-user-title">Edit user details</h2><p>Save changes to this company record. Account identity and company access are managed separately.</p>
    <fieldset disabled={busy}><legend>Personal details</legend><div className="profile-edit-grid">
      <label>First name<input autoFocus value={draft.first_name} maxLength={100} required onChange={event=>update('first_name',event.target.value)}/></label>
      <label>Last name<input value={draft.last_name} maxLength={100} required onChange={event=>update('last_name',event.target.value)}/></label>
      <label>Mobile phone<input aria-label="Mobile phone" aria-describedby="profile-phone-format" type="tel" value={draft.phone} maxLength={16} pattern="\+[1-9][0-9]{7,14}" required onChange={event=>update('phone',event.target.value)}/><span id="profile-phone-format">Use full international format, including + and country code.</span></label>
    </div></fieldset>
    <fieldset disabled={busy}><legend>Company details</legend><div className="profile-edit-grid">
      <label>Title<input value={draft.title} maxLength={100} onChange={event=>update('title',event.target.value)}/></label>
      <label>Team<input value={draft.team} maxLength={100} onChange={event=>update('team',event.target.value)}/></label>
      <label>Employment Start Date<input type="date" value={draft.employment_start_date || ''} min="0001-01-01" max="9999-12-31" onChange={event=>update('employment_start_date',event.target.value)}/></label>
      {fields.map(field=><label key={field.key}>{field.label}{field.required?' *':''}<input value={draft.custom_fields[field.key] || ''} maxLength={500} required={field.required} onChange={event=>setDraft(current=>({...current,custom_fields:{...current.custom_fields,[field.key]:event.target.value}}))}/></label>)}
    </div></fieldset>
    {error ? <p role="alert" className="error">{error}</p> : null}{blocked ? <p>Your draft remains here. Discard it and reload the latest details before making another edit.</p> : null}
    <div className="profile-edit-actions"><button type="button" disabled={busy} onClick={()=>onClose(false,!!blocked)}>Cancel</button>{blocked ? <button type="button" disabled={busy} onClick={()=>onClose(false,true)}>Discard draft and reload</button> : <button className="primary" type="submit" disabled={busy}>{busy?'Saving…':'Save changes'}</button>}</div>
  </form></dialog>;
}
