'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { csvCell } from '../../lib/csv';
import { formatEmploymentDate, formatTimestamp, compareDateValues } from '../../lib/agent-dates';
import { useRouter } from 'next/navigation';
import type { Agent, AgentField, AgentInput, Company, Member } from '../../lib/agent-types';
import ImportUsers, { type ImportResult } from './import-users';
import Filters, { useDirectoryFilters } from './filters';
import { blankFilters, filterAgents, filterFields } from '../../lib/agent-filters';
import './users.css';

type Row = { key: string; first_name: string; last_name: string; country: string; mobile: string; title: string; team: string; employment_start_date: string; custom_fields: Record<string,string> };
type Column = { key: string; label: string; value: (agent: Agent) => string };
function blank(): Row { return { key: crypto.randomUUID(), first_name: '', last_name: '', country: '+44', mobile: '', title: '', team: '', employment_start_date: '', custom_fields: {} }; }
function phone(row: Row) { const number=row.mobile.replace(/[\s()-]/g,''); return number.startsWith('+') ? number : row.country+number.replace(/^0/,''); }
function used(row: Row) { return !!(row.first_name || row.last_name || row.mobile || row.title || row.team || row.employment_start_date || Object.values(row.custom_fields).some(Boolean)); }
function valid(row: Row, fields: AgentField[]) { return !!row.first_name.trim() && !!row.last_name.trim() && /^\+[1-9][0-9]{7,14}$/.test(phone(row)) && fields.every(field => !field.required || row.custom_fields[field.key]?.trim()); }
function record(row: Row): AgentInput { return { first_name:row.first_name.trim(),last_name:row.last_name.trim(),phone:phone(row),title:row.title,team:row.team,employment_start_date:row.employment_start_date || null,custom_fields:row.custom_fields }; }

export default function Users({ companies,company,members,agents: initial,fields,actorId,canManage }: { companies:Company[];company:Company;members:Member[];agents:Agent[];fields:AgentField[];actorId:string;canManage:boolean }) {
  const router=useRouter();
  const [agents,setAgents]=useState(initial);
  const [currentMembers,setMembers]=useState(members);
  const [dialog,setDialog]=useState<'form'|'confirmation'|'import'|null>(null);
  const [tab,setTab]=useState<'users'|'admins'|'archived'>('users');
  const [search,setSearch]=useState(''); const [unjoined,setUnjoined]=useState(false);
  const [page,setPage]=useState(0); const [rowsPerPage,setRowsPerPage]=useState(25);
  const [sort,setSort]=useState({ key:'last_name',descending:false });
  const [hidden,setHidden]=useState<string[]>([]); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false); const [rows,setRows]=useState<Row[]>([]); const [editing,setEditing]=useState<Agent|null>(null);
  const [confirm,setConfirm]=useState<{ agent:Agent;action:'archive'|'restore' }|null>(null);
  const form=useRef<HTMLDialogElement>(null); const confirmation=useRef<HTMLDialogElement>(null);
  const member=(agent:Agent) => currentMembers.find(item=>item.user_id===agent.user_id);
  const admin=(agent:Agent) => ['owner','admin'].includes(member(agent)?.role || '');
  const columns:Column[]=[
    { key:'first_name',label:'First name',value:a=>a.first_name },{ key:'last_name',label:'Last name',value:a=>a.last_name },
    { key:'last_login',label:'Last login',value:a=>a.user_id ? 'Not recorded' : 'Not joined' },
    { key:'title',label:'Title',value:a=>a.title || '—' },{ key:'employment_start_date',label:'Employment Start Date',value:a=>formatEmploymentDate(a.employment_start_date) },
    { key:'team',label:'Team',value:a=>a.team || '—' },{ key:'kiosk',label:'Kiosk code',value:()=> '—' },
    { key:'created_at',label:'Date added',value:a=>formatTimestamp(a.created_at,company.time_zone) },{ key:'created_by',label:'Added by',value:a=>currentMembers.find(m=>m.user_id===a.created_by)?.display_name || '—' },
    ...(tab==='admins' ? [{ key:'role',label:'Access level',value:(a:Agent)=>member(a)?.role==='owner' ? 'Owner' : 'Admin' }] : []),
    ...fields.map(field=>({ key:field.key,label:field.label,value:(a:Agent)=>a.custom_fields[field.key] || '—' })),
  ];
  const supportedFilters=useMemo(()=>filterFields(fields,currentMembers,company.time_zone),[fields,currentMembers,company.time_zone]);
  const directoryFilters=useDirectoryFilters(company.id,actorId,supportedFilters);
  const displayed=columns.filter(column=>!hidden.includes(column.key));
  const filtered=filterAgents(agents,directoryFilters.state,supportedFilters).filter(agent=>(tab==='archived' ? agent.status==='archived' : agent.status==='active' && (tab!=='admins' || admin(agent))) && (!unjoined || !agent.user_id) && `${agent.first_name} ${agent.last_name} ${agent.phone} ${agent.title} ${agent.team} ${Object.values(agent.custom_fields).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const sorted=[...filtered].sort((a,b)=>{
    const dateOrder=sort.key==='employment_start_date' ? compareDateValues(a.employment_start_date,b.employment_start_date) : sort.key==='created_at' ? compareDateValues(a.created_at,b.created_at,true) : null;
    const column=columns.find(c=>c.key===sort.key);
    return (dateOrder ?? (column?.value(a)||'').localeCompare(column?.value(b)||'', 'en-GB',{numeric:true}))*(sort.descending?-1:1);
  });
  const safePage=Math.min(page,Math.max(0,Math.ceil(sorted.length/rowsPerPage)-1));
  const visible=sorted.slice(safePage*rowsPerPage,(safePage+1)*rowsPerPage);
  const populated=rows.filter(used); const ready=populated.length>0 && populated.every(row=>valid(row,fields));

  async function reload() {
    const response=await fetch(`/api/agents?tenantId=${company.id}`,{ cache:'no-store' }); const data=await response.json();
    if (!response.ok) throw new Error(data.error);setAgents(data.agents);setMembers(data.members);
  }
  async function mutate(changes: unknown[]) {
    const response=await fetch('/api/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:company.id,changes})});
    const data=await response.json(); if (!response.ok) throw new Error(data.error);
    await reload();
  }
  function open(agent?:Agent) {
    setError('');setNotice('');setEditing(agent || null);
    setRows(agent ? [{key:agent.id,first_name:agent.first_name,last_name:agent.last_name,country:'+44',mobile:agent.phone,title:agent.title,team:agent.team,employment_start_date:agent.employment_start_date || '',custom_fields:{...agent.custom_fields}}] : Array.from({length:5},blank));
    setDialog('form');form.current?.showModal();
  }
  async function save(event:React.FormEvent) {
    event.preventDefault();if(!ready || busy)return;setBusy(true);setError('');
    try {
      await mutate(populated.map(row=>editing ? {action:'update',id:editing.id,revision:editing.revision,...record(row)} : {action:'create',...record(row)}));
      form.current?.close();setNotice(editing ? 'User details saved.' : `${populated.length} user${populated.length===1?'':'s'} added. No invitations were sent.`);
    } catch(error) {setError(error instanceof Error ? error.message : 'The change could not be saved.');}
    finally {setBusy(false);}
  }
  function ask(agent:Agent,action:'archive'|'restore') { setError('');setConfirm({agent,action});setDialog('confirmation');confirmation.current?.showModal(); }
  async function archive() {
    if(!confirm || busy)return;setBusy(true);setError('');
    try { await mutate([{action:confirm.action,id:confirm.agent.id,revision:confirm.agent.revision}]);confirmation.current?.close();setNotice(confirm.action==='archive' ? 'User archived. Linked company access is suspended.' : 'User restored. Previous admin permissions are not restored.'); }
    catch(error) {setError(error instanceof Error ? error.message : 'The change could not be saved.');}
    finally {setBusy(false);}
  }
  function update(index:number,key:keyof Row,value:string,custom=false) {setRows(old=>old.map((row,i)=>i!==index ? row : custom ? {...row,custom_fields:{...row.custom_fields,[key]:value}} : {...row,[key]:value}));}
  function exportCsv() {
    const text=[displayed.map(c=>csvCell(c.label)).join(','),...sorted.map(a=>displayed.map(c=>csvCell(c.value(a))).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='users.csv';link.click();URL.revokeObjectURL(url);
  }
  async function importRecords(records:AgentInput[]):Promise<ImportResult> {
    let response:Response,data:{saved?:unknown;error?:string};
    try {response=await fetch('/api/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:company.id,changes:records.map(record=>({action:'create',...record}))})});data=await response.json();}
    catch{return {status:'unknown',message:'Import outcome could not be confirmed. Check the directory before trying again.'};}
    if(!response.ok)return {status:response.status>=500?'unknown':'rejected',message:data.error || 'The import could not be confirmed.'};
    if(!Array.isArray(data.saved) || data.saved.length!==records.length)return {status:'unknown',message:'The server response did not confirm the expected batch. Check the directory before trying again.'};
    let warning:string|undefined;
    try{await reload();}catch{warning='Users were imported, but the directory could not be refreshed. Reload the directory before importing again.';}
    setNotice(`${records.length} users imported. No invitations were sent.`);
    return {status:'saved',count:records.length,warning};
  }
  async function signout() {setBusy(true);try {const result=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});if(!result.ok)throw new Error('Sign out failed. Try again.');router.replace('/login');router.refresh();}catch(error){setError(error instanceof Error?error.message:'Sign out failed.');setBusy(false);}}
  return <div className="users-app">
    <div className="app-bar"><Link className="brand" href="/">CT Alt</Link><label className="company-switch"><span className="sr-only">Company</span><select value={company.id} onChange={event=>router.push(`/agents?company=${event.target.value}`)}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button onClick={signout} disabled={busy}>Sign out</button></div>
    <aside className="rail" aria-label="Modules"><Link href="/agents" aria-label="Users" aria-current="page">♙</Link></aside>
    <main className="users-main"><header className="users-heading"><span className="users-icon" aria-hidden="true">♙</span><h1>Users</h1></header>
      {notice ? <p role="status" className="feedback">{notice}</p> : null}{error && !dialog ? <p role="alert" className="error">{error}</p> : null}
      {directoryFilters.state.restored ? <p role="alert" className="error">{directoryFilters.state.restored==='removed' ? 'Some saved filter conditions were removed because their fields or operators are no longer available.' : 'Saved filter conditions could not be restored and were reset.'} Your results and export may include more users. Review the filters or choose Reset all to clear this notice.</p> : null}
      <div className="directory-card"><div role="tablist" aria-label="User status" className="tabs">{(['users','admins','archived'] as const).map(value=><button key={value} role="tab" aria-selected={tab===value} onClick={()=>{setTab(value);setPage(0);}}>{value[0].toUpperCase()+value.slice(1)} <span>({agents.filter(a=>value==='archived'?a.status==='archived':a.status==='active'&&(value!=='admins'||admin(a))).length})</span></button>)}</div>
        <div className="toolbar"><label className="search"><span aria-hidden="true">⌕</span><span className="sr-only">Search users</span><input type="search" placeholder="Search" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}} /></label>
          <Filters fields={supportedFilters} agents={agents} state={directoryFilters.state} onChange={state=>{directoryFilters.change(state);setPage(0);}} onReset={()=>{directoryFilters.change(blankFilters());setSearch('');setUnjoined(false);setPage(0);}}/>
          <div className="toolbar-right"><button className={unjoined?'unjoined selected':'unjoined'} aria-pressed={unjoined} onClick={()=>{setUnjoined(!unjoined);setPage(0);}}>Users haven’t joined yet</button><button onClick={exportCsv} aria-label="Export visible users">⇩</button>{canManage ? <details className="add-menu"><summary className="primary">Add users <span aria-hidden="true">⌄</span></summary><div className="add-menu-options"><button onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');open();}}>Add manually</button><button onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');setError('');setNotice('');setDialog('import');}}>Import users</button></div></details> : null}</div>
        </div>
        <div className="table-scroll"><table><thead><tr>{displayed.map(column=><th key={column.key} scope="col"><button onClick={()=>setSort({key:column.key,descending:sort.key===column.key&&!sort.descending})}>{column.label}{sort.key===column.key ? <span aria-hidden="true"> {sort.descending?'↓':'↑'}</span> : null}</button></th>)}<th scope="col"><details className="column-picker"><summary aria-label="Choose columns">☷</summary><fieldset><legend>Columns</legend>{columns.map(c=><label key={c.key}><input type="checkbox" checked={!hidden.includes(c.key)} onChange={()=>setHidden(old=>old.includes(c.key)?old.filter(key=>key!==c.key):[...old,c.key])}/>{c.label}</label>)}</fieldset></details></th></tr></thead><tbody>{visible.map(agent=><tr key={agent.id}>{displayed.map(c=><td key={c.key}>{c.key==='first_name' ? <span className="person"><span className="avatar" aria-hidden="true">{agent.first_name[0]}{agent.last_name[0]}</span>{c.value(agent)}</span> : c.value(agent)}</td>)}<td className="row-actions">{canManage ? <>{agent.status==='active' ? <button onClick={()=>open(agent)} aria-label={`Edit ${agent.first_name} ${agent.last_name}`}>Edit</button> : null}{agent.user_id!==actorId && member(agent)?.role!=='owner' ? <button onClick={()=>ask(agent,agent.status==='active'?'archive':'restore')}>{agent.status==='active'?'Archive':'Restore'}</button> : null}</> : null}</td></tr>)}{!visible.length ? <tr><td className="empty" colSpan={displayed.length+1}>No users match this view.</td></tr> : null}</tbody></table></div>
        <div className="pagination"><label>Rows per page<select value={rowsPerPage} onChange={e=>{setRowsPerPage(Number(e.target.value));setPage(0);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><span>{sorted.length ? `${safePage*rowsPerPage+1}–${Math.min((safePage+1)*rowsPerPage,sorted.length)}` : '0'} of {sorted.length}</span><button aria-label="Previous page" disabled={safePage===0} onClick={()=>setPage(safePage-1)}>‹</button><button aria-label="Next page" disabled={(safePage+1)*rowsPerPage>=sorted.length} onClick={()=>setPage(safePage+1)}>›</button></div>
      </div>{agents.length===1000 ? <p>Showing the first 1,000 records. Larger directories will need server pagination.</p> : null}
    </main>
    {canManage && dialog==='import' ? <ImportUsers fields={fields} agents={agents} onClose={()=>setDialog(null)} onImport={importRecords}/> : null}
    <dialog ref={form} className="user-dialog" aria-labelledby="user-dialog-title" onClose={()=>setDialog(null)} onCancel={event=>{if(busy)event.preventDefault();}}><form onSubmit={save}><div className="dialog-heading"><h2 id="user-dialog-title">{editing?'Edit user':'Add users'}</h2><button type="button" aria-label="Close" disabled={busy} onClick={()=>form.current?.close()}>×</button></div><p className="form-instructions">{editing ? 'Update this user’s details.' : 'Add users manually. Complete the required fields for each user you want to add.'} Required fields are marked *. No invitations will be sent.</p>
      <div className="entry-scroll"><table className="entry-grid"><thead><tr>{['First name *','Last name *','Mobile phone *','Title','Employment Start Date','Team',...fields.map(f=>f.label+(f.required?' *':''))].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={row.key}><td><label className="sr-only" htmlFor={`first-${row.key}`}>First name row {index+1}</label><input id={`first-${row.key}`} value={row.first_name} maxLength={100} onChange={e=>update(index,'first_name',e.target.value)} /></td><td><label className="sr-only" htmlFor={`last-${row.key}`}>Last name row {index+1}</label><input id={`last-${row.key}`} value={row.last_name} maxLength={100} onChange={e=>update(index,'last_name',e.target.value)} /></td><td><div className="phone-input"><label className="sr-only" htmlFor={`country-${row.key}`}>Country code row {index+1}</label><select id={`country-${row.key}`} value={row.country} onChange={e=>update(index,'country',e.target.value)}><option value="+44">UK +44</option><option value="+353">IE +353</option><option value="+1">US/CA +1</option><option value="+33">FR +33</option><option value="+49">DE +49</option><option value="+61">AU +61</option></select><label className="sr-only" htmlFor={`phone-${row.key}`}>Mobile phone row {index+1}</label><input id={`phone-${row.key}`} type="tel" value={row.mobile} maxLength={30} onChange={e=>update(index,'mobile',e.target.value)} /></div></td><td><label className="sr-only" htmlFor={`title-${row.key}`}>Title row {index+1}</label><input id={`title-${row.key}`} value={row.title} maxLength={100} onChange={e=>update(index,'title',e.target.value)} /></td><td><label className="sr-only" htmlFor={`start-${row.key}`}>Employment Start Date row {index+1}</label><input id={`start-${row.key}`} type="date" value={row.employment_start_date} onChange={e=>update(index,'employment_start_date',e.target.value)} /></td><td><label className="sr-only" htmlFor={`team-${row.key}`}>Team row {index+1}</label><input id={`team-${row.key}`} value={row.team} maxLength={100} onChange={e=>update(index,'team',e.target.value)} /></td>{fields.map(field=><td key={field.key}><label className="sr-only" htmlFor={`${field.key}-${row.key}`}>{field.label} row {index+1}</label><input id={`${field.key}-${row.key}`} value={row.custom_fields[field.key] || ''} maxLength={500} onChange={e=>update(index,field.key as keyof Row,e.target.value,true)} /></td>)}</tr>)}</tbody></table></div>
      {!editing ? <button className="another" type="button" disabled={rows.length>=25 || busy} onClick={()=>setRows(old=>[...old,blank()])}>+ Add another user</button> : null}
      <div className="dialog-footer"><div>{error ? <p role="alert" className="error">{error}</p> : populated.some(row=>!valid(row,fields)) ? <p>Complete the names, a valid mobile number and required company fields in every started row.</p> : <p>{editing ? 'Changes apply to this company only.' : 'Blank rows will be ignored.'}</p>}</div><button type="button" disabled={busy} onClick={()=>form.current?.close()}>Cancel</button><button className="primary" disabled={!ready || busy}>{busy?'Saving…':'Confirm'}</button></div>
    </form></dialog>
    <dialog ref={confirmation} className="confirm-dialog" aria-labelledby="confirm-title" onClose={()=>setDialog(null)} onCancel={event=>{if(busy)event.preventDefault();}}><h2 id="confirm-title">{confirm?.action==='archive'?'Archive':'Restore'} {confirm?.agent.first_name} {confirm?.agent.last_name}?</h2><p>{confirm?.action==='archive'?'Their history is retained and linked company access will be suspended.':'Their history is retained. Linked access returns as an ordinary user; admin permissions require separate promotion.'}</p>{error?<p role="alert" className="error">{error}</p>:null}<div><button disabled={busy} onClick={()=>confirmation.current?.close()}>Cancel</button><button className="primary" disabled={busy} onClick={archive}>{busy?'Saving…':confirm?.action==='archive'?'Archive':'Restore'}</button></div></dialog>
  </div>;
}
