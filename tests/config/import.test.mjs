import test from 'node:test';import assert from 'node:assert/strict';
import { decodeImportCsv, parseImportCsv, previewImport, suggestMapping, importFields, importPhone } from '../../lib/agent-import.ts';
import { csvCell } from '../../lib/csv.ts';
const custom=[{key:'client',label:'Client',required:true,position:1}];
const headers='First name,Last name,Mobile phone,Client';
const preview=(text,existing=[],fields=custom)=>{const csv=parseImportCsv(text);return previewImport(csv,suggestMapping(csv.headers,importFields(fields)),fields,existing,'+44');};
test('UTF-8/BOM, escaped quotes, commas and embedded CRLF retain original text and source lines',()=>{
 const csv=decodeImportCsv(new TextEncoder().encode('\uFEFF'+headers+'\r\n"Zoë, 李","O""Brien",+447700900801,"North\r\nSouth"\r\n\r\nAda,Example,+447700900802,Demo\r\n').buffer);
 assert.deepEqual(csv.rows[0],{line:2,values:['Zoë, 李','O"Brien','+447700900801','North\r\nSouth']});assert.equal(csv.rows[1].line,5);
 for(const newline of ['\r','\n','\r\n'])assert.equal(parseImportCsv('a,b'+newline+'x,y'+newline).rows.length,1);
 assert.equal(parseImportCsv('a,b\nx,').rows[0].values[1],'');
 assert.throws(()=>decodeImportCsv(new Uint8Array([0xff,0xfe,0]).buffer),/UTF-8/);
});
test('malformed quoting, inconsistent rows, nulls and duplicate/blank headers are rejected',()=>{
 for(const text of ['a,b\n"unclosed,y','a,b\n"closed"bad,y','a,b\nwrong"quote,y','a,b\nx','a,b\nx,y,z','First name,first_name\na,b',',b\nx,y','a,b\n\0,y','a,b\n\n'])assert.throws(()=>parseImportCsv(text));
 assert.deepEqual(parseImportCsv('名字,職位\n李,Demo').headers,['名字','職位']);
});
test('file, column, cell, row and atomic-batch limits are bounded',()=>{
 assert.throws(()=>parseImportCsv('x'.repeat(128*1024+1)),/128 KiB/);
 assert.throws(()=>parseImportCsv(Array(41).fill('a').join(',')+'\n'+Array(41).fill('x').join(',')),/40 columns/);
 assert.throws(()=>parseImportCsv('a\n'+'x'.repeat(2001)),/2,000/);
 assert.throws(()=>parseImportCsv('a,b,c,d,e\n'+Array(5).fill('x'.repeat(1800)).join(',')),/8 KiB/);
 assert.throws(()=>parseImportCsv('a\n'+Array(26).fill('x').join('\n')),/25 data rows/);
 assert.equal(parseImportCsv('a\n'+Array(25).fill('x').join('\n')).rows.length,25);
});
test('mapping requires supported targets once each and required company fields',()=>{
 const csv=parseImportCsv('Given,Surname,Number,Company,Unknown\nAda,Example,+447700900803,Demo,ignored');
 const valid=previewImport(csv,['first_name','last_name','phone','custom:client',''],custom,[],'+44');assert.equal(valid.valid,true);assert.deepEqual(valid.rows[0].record.custom_fields,{client:'Demo'});
 assert.equal(previewImport(csv,['first_name','first_name','phone','custom:client',''],custom,[],'+44').valid,false);
 assert.equal(previewImport(csv,['first_name','last_name','phone','',''],custom,[],'+44').valid,false);
 assert.equal(previewImport(csv,['first_name','last_name','phone','role',''],custom,[],'+44').valid,false);
});
test('phone identities normalize formatting/country codes and duplicate/existing checks use that identity',()=>{
 assert.equal(importPhone('07700 900804','44'),'+447700900804');assert.equal(importPhone('+44 (7700) 900804','+1'),'+447700900804');
 assert.equal(importPhone('00447700900804','+1'),'+447700900804');assert.equal(importPhone('7.700e9','+44'),'');assert.equal(importPhone('-447700900804','+44'),'');assert.equal(importPhone('07700900804','UK'),'');
 const duplicate=preview(headers+'\nAda,One,07700 900804,Demo\nBen,Two,+447700900804,Demo');assert.equal(duplicate.valid,false);assert.equal(duplicate.rows.every(row=>row.errors.includes('Duplicate mobile number within this file.')),true);
 const skipped=preview(headers+'\n,,07700 900804,\nBen,New,+447700900805,Demo',[{phone:'+447700900804',status:'archived'}]);assert.equal(skipped.valid,true);assert.equal(skipped.skipped,1);assert.equal(skipped.added,1);assert.equal(skipped.rows[0].errors.length,0);
 assert.equal(preview(headers+'\nAda,Only,+447700900804,Demo',[{phone:'+447700900804'}]).valid,false);
});
test('names, lengths, required text fields and finite ISO dates are validated before review',()=>{
 for(const row of [',Example,+447700900806,Demo','Ada,,+447700900806,Demo','Ada,Example,invalid,Demo','Ada,Example,+447700900806,','x'.repeat(101)+',Example,+447700900806,Demo'])assert.equal(preview(headers+'\n'+row).valid,false);
 for(const date of ['2023-02-29','infinity','0000-01-01','2026-1-1'])assert.equal(preview(headers+',Employment Start Date\nAda,Example,+447700900806,Demo,'+date).valid,false);
 assert.equal(preview(headers+',Employment Start Date\nAda,Example,+447700900806,Demo,2024-02-29').valid,true);
 const constructor=[{key:'constructor',label:'Constructor',required:false,position:1}];assert.equal(preview('First name,Last name,Mobile phone\nAda,Example,+447700900806',[],constructor).valid,true);
});
test('formula and HTML-like text remain inert original strings; export neutralizes formulas',()=>{
 const value=preview(headers+'\n=1+1,Example,+447700900807,"<img src=x onerror=alert(1)>"');assert.equal(value.valid,true);assert.equal(value.rows[0].record.first_name,'=1+1');assert.equal(csvCell(value.rows[0].record.first_name),'"\'=1+1"');assert.equal(value.rows[0].record.custom_fields.client,'<img src=x onerror=alert(1)>');
});
test('large mapped batches are rejected before submission even inside the file limit',()=>{
 const fields=Array.from({length:5},(_,i)=>({key:'field'+i,label:'Field '+i,required:false,position:i}));
 const header='First name,Last name,Mobile phone,'+fields.map(field=>field.label).join(',');
 const rows=Array.from({length:25},(_,i)=>'Ada,Example,+447700901'+String(i).padStart(3,'0')+','+Array(5).fill('x'.repeat(500)).join(','));
 const result=preview(header+'\n'+rows.join('\n'),[],fields);assert.equal(result.valid,false);assert.equal(result.issues.some(issue=>issue.includes('48 KiB')),true);
});
