'use client';
import { useState, useSyncExternalStore } from 'react';
import './filters.css';
import { activeRules, operatorLabels, operators, preferenceKey, quickCompatible, restoreFilters, type FilterField, type FilterState } from '../../lib/agent-filters';

const fallback=new Map<string,string>();
function subscribe(callback:()=>void) {
  window.addEventListener('storage',callback);window.addEventListener('ct-alt-filter-preference',callback);
  return ()=>{window.removeEventListener('storage',callback);window.removeEventListener('ct-alt-filter-preference',callback);};
}
function read(key:string) {
  if(fallback.has(key))return fallback.get(key)!;
  try{return window.localStorage.getItem(key);}catch{return null;}
}
export function useDirectoryFilters(companyId:string,actorId:string,fields:FilterField[]) {
  const key=preferenceKey(companyId,actorId);
  const raw=useSyncExternalStore(subscribe,()=>read(key),()=>null);
  const state=restoreFilters(raw,fields);
  const change=(next:FilterState)=>{
    const text=JSON.stringify(next);
    try{window.localStorage.setItem(key,text);fallback.delete(key);}catch{fallback.set(key,text);}
    window.dispatchEvent(new Event('ct-alt-filter-preference'));
  };
  return {state,change};
}

export default function Filters({fields,agents,state,onChange,onReset}:{fields:FilterField[];agents:import('../../lib/agent-types').Agent[];state:FilterState;onChange:(state:FilterState)=>void;onReset:()=>void}) {
  const [fieldSearch,setFieldSearch]=useState('');
  const compatible=quickCompatible(state,fields),advanced=state.mode==='advanced';
  const active=activeRules(state,fields).length,incomplete=state.rules.length-active;
  function add() {
    const field=fields.find(f=>f.key==='team') || fields[0];if(!field || state.rules.length>=10)return;
    onChange({...state,rules:[...state.rules,{id:crypto.randomUUID(),field:field.key,operator:'is',value:'',end:''}]});
  }
  function update(id:string,patch:Partial<FilterState['rules'][number]>) {
    onChange({...state,rules:state.rules.map(rule=>rule.id===id ? {...rule,...patch} : rule)});
  }
  return <details className="filter directory-filter"><summary aria-label="Filter users">Filter {active ? <span className="filter-dot" aria-label={`${active} active filters`} /> : null}</summary>
    <div className="filter-panel" role="region" aria-label="User filters">
      <div className="filter-heading"><strong>{advanced?'Advanced filters':'Quick filters'}</strong><button onClick={()=>{setFieldSearch('');onReset();}}>Reset all</button></div>
      {!advanced && !compatible ? <p className="filter-help">These conditions need advanced filters. Switch back to edit them; your conditions still apply.</p> : <>
        {advanced ? <><label>Search fields<input type="search" value={fieldSearch} onChange={event=>setFieldSearch(event.target.value)} placeholder="Search user details and custom fields" /></label><label>Match conditions<select value={state.join} onChange={event=>onChange({...state,join:event.target.value as 'and'|'or'})}><option value="and">All (AND)</option><option value="or">Any (OR)</option></select></label></> : <p className="filter-help">Choose exact values. For dates or other conditions, use advanced filters.</p>}
        {state.rules.map((rule,index)=>{
          const field=fields.find(f=>f.key===rule.field)!;
          const valueOptions=field.options || [...new Set(agents.map(field.read).filter(value=>value.trim()))].sort().map(value=>({value,label:value}));
          const needsValue=!['empty','not_empty'].includes(rule.operator);
          return <fieldset className="filter-rule" key={rule.id}><legend>Filter {index+1}</legend><div className="filter-rule-controls">
            <label><span className="sr-only">Field filter {index+1}</span><select aria-label={`Field filter ${index+1}`} value={rule.field} onChange={event=>update(rule.id,{field:event.target.value,operator:'is',value:'',end:''})}>{(['Custom fields','User details'] as const).map(group=><optgroup label={group} key={group}>{fields.filter(f=>f.group===group && (advanced || f.kind!=='date') && (f.key===rule.field || f.label.toLowerCase().includes(fieldSearch.toLowerCase()))).map(f=><option value={f.key} key={f.key}>{f.label}</option>)}</optgroup>)}</select></label>
            {advanced ? <label><span className="sr-only">Operator filter {index+1}</span><select aria-label={`Operator filter ${index+1}`} value={rule.operator} onChange={event=>update(rule.id,{operator:event.target.value as typeof rule.operator,end:''})}>{operators(field).map(operator=><option value={operator} key={operator}>{operatorLabels[operator]}</option>)}</select></label> : <span className="quick-is">Is</span>}
            {needsValue ? <label><span className="sr-only">{field.kind==='date' && rule.operator==='between'?'Start date':'Value'} filter {index+1}</span>{field.kind==='choice' || !advanced ? <select aria-label={`Value filter ${index+1}`} value={rule.value} onChange={event=>update(rule.id,{value:event.target.value})}><option value="">Select value</option>{rule.value && !valueOptions.some(option=>option.value===rule.value) ? <option value={rule.value}>{rule.value}</option> : null}{valueOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input aria-label={`${field.kind==='date' && rule.operator==='between'?'Start date':'Value'} filter ${index+1}`} type={field.kind==='date'?'date':'text'} maxLength={field.kind==='date'?10:500} value={rule.value} onChange={event=>update(rule.id,{value:event.target.value})}/>}</label> : null}
            {field.kind==='date' && rule.operator==='between' ? <label><span className="sr-only">End date filter {index+1}</span><input aria-label={`End date filter ${index+1}`} type="date" maxLength={10} min={rule.value || undefined} value={rule.end} onChange={event=>update(rule.id,{end:event.target.value})}/></label> : null}
            <button aria-label={`Remove filter ${index+1}`} onClick={()=>onChange({...state,rules:state.rules.filter(item=>item.id!==rule.id)})}>×</button>
          </div></fieldset>;
        })}
        <button onClick={add} disabled={state.rules.length>=10}>+ Add filter</button>
      </>}
      {incomplete ? <p className="filter-help" role="status">{incomplete} incomplete {incomplete===1?'filter is':'filters are'} not applied. Complete values and valid date ranges.</p> : null}
      <button className="filter-switch" onClick={()=>{setFieldSearch('');onChange({...state,mode:advanced?'quick':'advanced'});}}>{advanced?'Switch to quick filters':'Advanced filters'}</button>
      <p className="filter-help">Saved for this account and company in this browser.</p>
    </div>
  </details>;
}
