import type { Agent, AgentField, AgentInput } from './agent-types';

export const importLimits={bytes:128*1024,rows:25,columns:40,cell:2000,rowBytes:8192,payloadBytes:48000};
export type CsvData={headers:string[];rows:{line:number;values:string[]}[]};
export type ImportField={key:string;label:string;required:boolean};
export type ImportPreview={line:number;record:AgentInput;errors:string[];skip:boolean};
const bytes=(value:string)=>new TextEncoder().encode(value).length;
const normalized=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en-GB').replace(/[^\p{L}\p{N}]/gu,'');
export function parseImportCsv(text:string):CsvData {
  if(bytes(text)>importLimits.bytes)throw new Error('CSV files must be at most 128 KiB.');
  if(text.includes('\0'))throw new Error('CSV contains a null character.');
  text=text.replace(/^\uFEFF/,'');
  const records:{line:number;values:string[]}[]=[];
  let values:string[]=[],cell='',state:'plain'|'quoted'|'closed'='plain',line=1,start=1;
  const append=(value:string)=>{cell+=value;if(cell.length>importLimits.cell)throw new Error(`CSV cell exceeds 2,000 characters near line ${line}.`);};
  const field=()=>{values.push(cell);cell='';state='plain';if(values.length>importLimits.columns)throw new Error('CSV supports at most 40 columns.');};
  const row=()=>{
    field();if(bytes(values.join(','))>importLimits.rowBytes)throw new Error(`CSV row exceeds 8 KiB at line ${start}.`);
    if(!records.length || values.some(value=>value.trim()))records.push({line:start,values});
    values=[];if(records.length>importLimits.rows+1)throw new Error('Import at most 25 data rows at once.');
  };
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(state==='quoted') {
      if(c==='"') {if(text[i+1]==='"'){append('"');i++;}else state='closed';}
      else {append(c);if(c==='\r' || c==='\n' && text[i-1]!=='\r')line++;}
    } else if(c===',')field();
    else if(c==='\r' || c==='\n') {row();if(c==='\r' && text[i+1]==='\n')i++;line++;start=line;}
    else if(c==='"' && state==='plain' && !cell)state='quoted';
    else {if(state==='closed' || c==='"')throw new Error(`Invalid CSV quoting near line ${line}.`);append(c);}
  }
  if(state==='quoted')throw new Error('CSV contains an unclosed quoted field.');
  if(cell || values.length || state==='closed')row();
  if(records.length<2)throw new Error('CSV needs a header and at least one nonblank data row.');
  const headers=records[0].values.map(value=>value.trim());
  if(headers.some(header=>!header || header.length>100))throw new Error('Column headers must be nonempty and at most 100 characters.');
  if(new Set(headers.map(normalized)).size!==headers.length)throw new Error('CSV column headers must be unique.');
  for(const record of records.slice(1))if(record.values.length!==headers.length)throw new Error(`Column count does not match the header at line ${record.line}.`);
  return {headers,rows:records.slice(1)};
}
export function decodeImportCsv(buffer:ArrayBuffer) {
  if(buffer.byteLength>importLimits.bytes)throw new Error('CSV files must be at most 128 KiB.');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('Save the CSV as UTF-8 before uploading.');}
  return parseImportCsv(text);
}
export function importFields(fields:AgentField[]):ImportField[] {
  return [{key:'first_name',label:'First name',required:true},{key:'last_name',label:'Last name',required:true},{key:'phone',label:'Mobile phone',required:true},{key:'country',label:'Country code',required:false},{key:'title',label:'Title',required:false},{key:'team',label:'Team',required:false},{key:'employment_start_date',label:'Employment Start Date',required:false},...fields.map(field=>({key:'custom:'+field.key,label:field.label,required:field.required}))];
}
export function suggestMapping(headers:string[],fields:ImportField[]) {
  const aliases:Record<string,string>={firstname:'first_name',lastname:'last_name',mobile:'phone',mobilephone:'phone',mobilephonenumber:'phone',phone:'phone',phonenumber:'phone',countrycode:'country',employmentstartdate:'employment_start_date'};
  return headers.map(header=>{
    const value=normalized(header),matches=fields.filter(field=>normalized(field.label)===value || normalized(field.key)===value || aliases[value]===field.key);
    return matches.length===1 ? matches[0].key : '';
  });
}
export function importPhone(value:string,country:string) {
  if(value.trim().startsWith('-'))return '';
  const number=value.trim().replace(/[\s()-]/g,'');
  if(number.startsWith('+'))return number;
  if(number.startsWith('00'))return '+'+number.slice(2);
  const code=country.trim().replace(/^\+?/,'+');
  if(!/^\+[1-9]\d{0,3}$/.test(code) || !/^\d+$/.test(number))return '';
  return code+number.replace(/^0/,'');
}
function validDate(value:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-'))return false;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10)===value;
}
export function previewImport(csv:CsvData,mapping:string[],custom:AgentField[],existing:Agent[],defaultCountry:string) {
  const fields=importFields(custom),allowed=new Set(fields.map(field=>field.key)),issues:string[]=[];
  if(mapping.length!==csv.headers.length || mapping.some(key=>key && !allowed.has(key)))issues.push('Choose supported fields for every mapped column.');
  const selected=mapping.filter(Boolean);
  if(new Set(selected).size!==selected.length)issues.push('Each user field can be mapped only once.');
  for(const field of fields)if(field.required && !selected.includes(field.key))issues.push(`Map required field: ${field.label}.`);
  const seen=new Map<string,number[]>(),phones=new Set(existing.map(agent=>agent.phone));
  const rows:ImportPreview[]=csv.rows.map(row=>{
    const mapped=Object.fromEntries(mapping.flatMap((key,index)=>key && allowed.has(key) ? [[key,row.values[index]]] : []));
    const phone=importPhone(mapped.phone || '',mapped.country || defaultCountry);
    const record:AgentInput={first_name:(mapped.first_name || '').trim(),last_name:(mapped.last_name || '').trim(),phone,title:mapped.title || '',team:mapped.team || '',employment_start_date:mapped.employment_start_date?.trim() || null,custom_fields:Object.fromEntries(custom.filter(field=>selected.includes('custom:'+field.key)).map(field=>[field.key,mapped['custom:'+field.key] || '']))};
    const errors:string[]=[];const skip=phones.has(phone);
    if(!/^\+[1-9][0-9]{7,14}$/.test(phone))errors.push('Enter a valid mobile number and country code; preserve phone digits as text.');
    if(phone)seen.set(phone,[...(seen.get(phone) || []),row.line]);
    if(!skip) {
      if(!record.first_name || record.first_name.length>100)errors.push('First name is required (maximum 100 characters).');
      if(!record.last_name || record.last_name.length>100)errors.push('Last name is required (maximum 100 characters).');
      if(record.title.length>100 || record.team.length>100)errors.push('Title and Team must be at most 100 characters.');
      if(record.employment_start_date && !validDate(record.employment_start_date))errors.push('Employment Start Date must be a valid YYYY-MM-DD date.');
      for(const field of custom){const value=typeof record.custom_fields[field.key]==='string' ? record.custom_fields[field.key] : '';if(field.required && !value.trim())errors.push(`${field.label} is required.`);if(value.length>500)errors.push(`${field.label} must be at most 500 characters.`);}
    }
    return {line:row.line,record,errors,skip};
  });
  for(const row of rows)if((seen.get(row.record.phone)?.length || 0)>1)row.errors.push('Duplicate mobile number within this file.');
  const added=rows.filter(row=>!row.skip);
  if(bytes(JSON.stringify(added.map(row=>({action:'create',...row.record}))))>importLimits.payloadBytes)issues.push('Mapped data exceeds the 48 KiB batch limit. Split the file before importing.');
  return {rows,issues,added:added.length,skipped:rows.length-added.length,valid:!issues.length && rows.every(row=>!row.errors.length) && added.length>0};
}
