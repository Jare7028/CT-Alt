import type { Agent, AgentField, Member } from './agent-types';

export type FilterOperator = 'is' | 'is_not' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'empty' | 'not_empty' | 'before' | 'after' | 'between';
export type FilterRule = { id:string; field:string; operator:FilterOperator; value:string; end:string };
export type FilterState = { version:1; mode:'quick'|'advanced'; join:'and'|'or'; rules:FilterRule[]; restored?:'removed'|'reset' };
export type FilterField = { key:string; label:string; group:'Custom fields'|'User details'; kind:'text'|'date'|'choice'; options?:{value:string;label:string}[]; read:(agent:Agent)=>string };
export const operatorLabels:Record<FilterOperator,string> = {is:'Is',is_not:'Is not',contains:'Contains',not_contains:'Does not contain',starts_with:'Starts with',ends_with:'Ends with',empty:'Is empty',not_empty:'Is not empty',before:'Before',after:'After',between:'Between'};
export const blankFilters=():FilterState=>({version:1,mode:'quick',join:'and',rules:[]});
export function operators(field:FilterField):FilterOperator[] {
  return field.kind==='date' ? ['is','is_not','before','after','between','empty','not_empty'] : field.kind==='choice' ? ['is','is_not','empty','not_empty'] : ['is','is_not','contains','not_contains','starts_with','ends_with','empty','not_empty'];
}
export function calendarDate(value:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-'))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10)===value;
}
const dateFormatters=new Map<string,Intl.DateTimeFormat>();
export function companyDate(value:string,timeZone:string) {
  const date=new Date(value);if(!Number.isFinite(date.valueOf()))return '';
  let formatter=dateFormatters.get(timeZone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});if(dateFormatters.size>=32)dateFormatters.delete(dateFormatters.keys().next().value!);dateFormatters.set(timeZone,formatter);}
  const parts=formatter.formatToParts(date);
  const part=(type:string)=>parts.find(p=>p.type===type)?.value || '';
  return `${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`;
}
export function filterFields(custom:AgentField[],members:Member[],timeZone:string):FilterField[] {
  const byUser=new Map(members.map(member=>[member.user_id,member]));
  const dates=new WeakMap<Agent,{timestamp:string;day:string}>();
  const addedDate=(agent:Agent)=>{const cached=dates.get(agent);if(cached?.timestamp===agent.created_at)return cached.day;const day=companyDate(agent.created_at,timeZone);dates.set(agent,{timestamp:agent.created_at,day});return day;};
  return [
    ...custom.map(field=>({key:'custom:'+field.key,label:field.label,group:'Custom fields' as const,kind:'text' as const,read:(a:Agent)=>typeof a.custom_fields[field.key]==='string' ? a.custom_fields[field.key] : ''})),
    ...(['first_name','last_name','phone','title','team'] as const).map(key=>({key,label:{first_name:'First name',last_name:'Last name',phone:'Mobile phone',title:'Title',team:'Team'}[key],group:'User details' as const,kind:'text' as const,read:(a:Agent)=>a[key]})),
    {key:'employment_start_date',label:'Employment Start Date',group:'User details',kind:'date',read:a=>a.employment_start_date || ''},
    {key:'created_at',label:'Date added',group:'User details',kind:'date',read:addedDate},
    {key:'role',label:'User type',group:'User details',kind:'choice',options:['owner','admin','manager','employee'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})),read:a=>a.user_id ? byUser.get(a.user_id)?.role || '' : ''},
    {key:'joined',label:'Joined status',group:'User details',kind:'choice',options:[{value:'yes',label:'Joined'},{value:'no',label:'Not joined'}],read:a=>a.user_id ? 'yes' : 'no'},
  ];
}
export function completeRule(rule:FilterRule,field:FilterField) {
  if(!operators(field).includes(rule.operator))return false;
  if(rule.operator==='empty' || rule.operator==='not_empty')return true;
  if(!rule.value.trim())return false;
  if(field.kind==='choice')return !!field.options?.some(option=>option.value===rule.value);
  if(field.kind==='date')return calendarDate(rule.value) && (rule.operator!=='between' || calendarDate(rule.end) && rule.end>=rule.value);
  return true;
}
export function activeRules(state:FilterState,fields:FilterField[]) {
  const byKey=new Map(fields.map(field=>[field.key,field]));
  return state.rules.flatMap(rule=>{const field=byKey.get(rule.field);return field && completeRule(rule,field) ? [{rule,field}] : [];});
}
export function matchesRule(agent:Agent,rule:FilterRule,field:FilterField) {
  const raw=field.read(agent),value=raw.trim().toLocaleLowerCase('en-GB'),target=rule.value.trim().toLocaleLowerCase('en-GB');
  if(rule.operator==='empty')return !value;
  if(rule.operator==='not_empty')return !!value;
  // Missing dates never satisfy comparisons or their negative variants.
  if(field.kind==='date' && !calendarDate(raw))return false;
  switch(rule.operator) {
    case 'is':return value===target;
    case 'is_not':return value!==target;
    case 'contains':return value.includes(target);
    case 'not_contains':return !value.includes(target);
    case 'starts_with':return value.startsWith(target);
    case 'ends_with':return value.endsWith(target);
    case 'before':return raw<rule.value;
    case 'after':return raw>rule.value;
    case 'between':return raw>=rule.value && raw<=rule.end;
    default:return false;
  }
}
export function filterAgents(agents:Agent[],state:FilterState,fields:FilterField[]) {
  const active=activeRules(state,fields);
  if(!active.length)return agents;
  return agents.filter(agent=>state.join==='or' ? active.some(({rule,field})=>matchesRule(agent,rule,field)) : active.every(({rule,field})=>matchesRule(agent,rule,field)));
}
export function quickCompatible(state:FilterState,fields:FilterField[]) {
  return state.join==='and' && state.rules.every(rule=>rule.operator==='is' && fields.some(field=>field.key===rule.field && field.kind!=='date'));
}
export function preferenceKey(companyId:string,actorId:string) {return `ct-alt:agent-filters:v1:${companyId}:${actorId}`;}
export function restoreFilters(raw:string|null,fields:FilterField[]):FilterState {
  const reset=():FilterState=>({...blankFilters(),restored:'reset'});
  if(!raw)return blankFilters();
  if(raw.length>15000)return reset();
  try {
    const data=JSON.parse(raw);
    if(data.version!==1 || !['quick','advanced'].includes(data.mode) || !['and','or'].includes(data.join) || !Array.isArray(data.rules) || data.rules.length>10)return reset();
    const rules:FilterRule[]=data.rules.filter((rule:FilterRule)=>rule && typeof rule.id==='string' && /^[\w-]{1,64}$/.test(rule.id) && typeof rule.value==='string' && rule.value.length<=500 && typeof rule.end==='string' && rule.end.length<=10 && fields.some(field=>field.key===rule.field && operators(field).includes(rule.operator)));
    if(new Set(rules.map(rule=>rule.id)).size!==rules.length)return reset();
    const restored=rules.length!==data.rules.length ? 'removed' : ['removed','reset'].includes(data.restored) ? data.restored : undefined;
    return {version:1,mode:data.mode,join:data.join,rules:rules.map(({id,field,operator,value,end})=>({id,field,operator,value,end})),...(restored ? {restored} : {})};
  } catch {return reset();}
}
