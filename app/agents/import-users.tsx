'use client';
import { useEffect, useRef, useState } from 'react';
import type { Agent, AgentField, AgentInput } from '../../lib/agent-types';
import { decodeImportCsv, importFields, importLimits, previewImport, suggestMapping, type CsvData } from '../../lib/agent-import';
import './import-users.css';

export type ImportResult={status:'saved';count:number;skipped?:number;warning?:string}|{status:'rejected'|'unknown';message:string};
export default function ImportUsers({fields,agents,onClose,onImport}:{fields:AgentField[];agents:Agent[];onClose:()=>void;onImport:(records:AgentInput[])=>Promise<ImportResult>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [csv,setCsv]=useState<CsvData|null>(null),[mapping,setMapping]=useState<string[]>([]);
  const [fileName,setFileName]=useState(''),[country,setCountry]=useState('+44');
  const [error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [review,setReview]=useState(false),[result,setResult]=useState<ImportResult|null>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const supported=importFields(fields);
  const preview=csv ? previewImport(csv,mapping,fields,agents,country) : null;
  async function upload(file:File|undefined) {
    setCsv(null);setMapping([]);setReview(false);setResult(null);setError('');setFileName('');
    if(!file)return;
    if(file.size>importLimits.bytes){setError('CSV files must be at most 128 KiB.');return;}
    setLoading(true);
    try {const data=decodeImportCsv(await file.arrayBuffer());setCsv(data);setMapping(suggestMapping(data.headers,supported));setFileName(file.name);}
    catch(error){setError(error instanceof Error ? error.message : 'CSV could not be read.');}
    finally{setLoading(false);}
  }
  async function confirm() {
    if(busy || result || !review || !preview?.valid)return;
    setBusy(true);setError('');
    const skipped=preview.skipped;
    try{const outcome=await onImport(preview.rows.filter(row=>!row.skip).map(row=>row.record));setResult(outcome.status==='saved' ? {...outcome,skipped} : outcome);}
    catch{setResult({status:'unknown',message:'Import outcome could not be confirmed. Check the directory before trying again.'});}
    finally{setBusy(false);}
  }
  return <dialog ref={dialog} className="user-dialog import-dialog" aria-labelledby="import-title" onClose={onClose} onCancel={event=>{if(busy || loading)event.preventDefault();}}>
    <div className="dialog-heading"><h2 id="import-title">Import users</h2><button aria-label="Close import" disabled={busy || loading} onClick={onClose}>×</button></div>
    <div className="import-content">
      <p>Add new users only. Existing mobile numbers are skipped without updates. No invitations will be sent.</p>
      <p>Upload a UTF-8 CSV with a header and at most 25 users. Each import is one atomic batch; files up to 128 KiB, 40 columns and 8 KiB per decoded row are supported.</p>
      {error ? <p role="alert" className="error">{error}</p> : null}
      {result ? <div aria-live="polite">{result.status==='saved' ? <><h3>Import complete</h3><p>{result.count} new users added. {result.skipped || 0} existing users skipped. No invitations were sent.</p>{result.warning ? <p role="alert" className="error">{result.warning}</p> : null}</> : <><h3>{result.status==='unknown'?'Check import outcome':'Import not applied'}</h3><p role="alert" className="error">{result.message}</p><p>{result.status==='unknown'?'Do not repeat the import until you have checked the directory.':'The batch was rejected. No users were added by this batch.'}</p></>}{result.status==='unknown' || result.status==='saved' && result.warning ? <button onClick={()=>window.location.reload()}>Reload directory</button> : null}</div> : review && preview ? <section aria-label="Import summary"><h3>Review add-only import</h3><p><strong>{preview.added}</strong> new users will be added; <strong>{preview.skipped}</strong> existing users will be skipped. No existing details, company access or roles will change.</p><p>All new users are saved together. If a mobile number becomes unavailable or validation fails, the entire batch is rejected.</p><p>File: {fileName}. Company phone identities are checked again by the database at confirmation.</p></section> : <>
        <label className="import-file">CSV file<input type="file" accept=".csv,text/csv" disabled={loading} onChange={event=>void upload(event.target.files?.[0])}/></label>
        {loading ? <p role="status">Reading CSV…</p> : null}
        {csv && preview ? <>
          <h3>Map columns</h3><p>Match each column to a supported user field or choose Ignore. Required user fields are marked *. Unknown columns default to Ignore; new custom fields are not created.</p>
          <label className="import-country">Default country code<select aria-label="Default country code" value={country} onChange={event=>setCountry(event.target.value)}><option value="+44">UK +44</option><option value="+353">IE +353</option><option value="+1">US/CA +1</option><option value="+33">FR +33</option><option value="+49">DE +49</option><option value="+61">AU +61</option></select></label>
          <p>International phone values starting with + or 00 keep their country code. National numbers are supported for UK, IE, US/CA, FR, DE and AU, using the mapped Country code or the default above. Other countries require full international format. Preserve phone numbers as spreadsheet text.</p>
          <div className="import-mapping">{csv.headers.map((header,index)=><label key={index}>{header}<select aria-label={`Map column ${header}`} value={mapping[index] || ''} onChange={event=>setMapping(old=>old.map((value,i)=>i===index?event.target.value:value))}><option value="">Ignore</option>{supported.map(field=><option key={field.key} value={field.key}>{field.label}{field.required?' *':''}</option>)}</select></label>)}</div>
          {mapping.some(value=>!value) ? <p role="status">{mapping.filter(value=>!value).length} column(s) will be ignored.</p> : null}
          {preview.issues.length ? <ul className="import-errors" aria-label="Mapping errors">{preview.issues.map(issue=><li key={issue}>{issue}</li>)}</ul> : null}
          <h3>Validation preview</h3><p>{preview.added} new users; {preview.skipped} existing users to skip. Existing-number checks cover the loaded directory; the database enforces company uniqueness for every record.</p>
          <div className="entry-scroll import-preview"><table><thead><tr>{['CSV line','First name','Last name','Mobile phone','Result'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{preview.rows.map(row=><tr key={row.line}><td>{row.line}</td><td>{row.record.first_name}</td><td>{row.record.last_name}</td><td>{row.record.phone || 'Invalid phone'}</td><td className={row.errors.length?'import-errors':''}>{row.errors.length ? <ul>{row.errors.map(message=><li key={message}>{message}</li>)}</ul> : row.skip ? 'Skip existing user' : 'Ready to add'}</td></tr>)}</tbody></table></div>
          {!preview.added ? <p role="status">No new users to add.</p> : null}
          <p>Correct row errors in your CSV and upload it again. Nothing is saved during preview.</p>
        </> : null}
      </>}
    </div>
    <div className="dialog-footer">{result ? <button className="primary" onClick={onClose}>Close</button> : <><button disabled={busy || loading} onClick={onClose}>Cancel</button>{review ? <><button disabled={busy} onClick={()=>setReview(false)}>Back to mapping</button><button className="primary" disabled={busy || !preview?.valid} onClick={()=>void confirm()}>{busy?'Importing…':'Confirm add-only import'}</button></> : <button className="primary" disabled={loading || !preview?.valid} onClick={()=>setReview(true)}>Review import</button>}</>}</div>
  </dialog>;
}
