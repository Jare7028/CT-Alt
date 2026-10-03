import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChatSearchQuery,decodeChatSearchCursor,readChatSearch} from '../../lib/chat-search.ts';
const tenantId='71000000-0000-4000-8000-000000000001',conversationId='72000000-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000701',other='00000000-0000-4000-8000-000000000702';
const query={tenantId,conversationId,query:'inspection',limit:2};
const cursor={tenantId,conversationId,actorId,query:'inspection',sequence:'9007199254740994'};
const messages=['9007199254740995','9007199254740994'].map(sequence=>({conversation_id:conversationId,sequence,sender_id:actorId,sender_name:'Stored synthetic sender',body:'Inspection <script>literal body</script>',created_at:'2026-10-03T12:00:00.123456+00:00'}));
const result={tenantId,conversationId,actorId,query:'inspection',total:1505,messages,nextCursor:cursor};
function fixture(data=result,error=null,access={data:{id:conversationId},error:null}){const calls=[];return {calls,client:{auth:{getUser:async()=>({data:{user:{id:actorId}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return {data,error};},from:table=>({select:fields=>{const filters=[];const builder={eq:(key,value)=>{filters.push([key,value]);return builder;},maybeSingle:async()=>{calls.push({table,fields,filters});return access;}};return builder;}})}};}
const rejectStatus=(promise,status)=>assert.rejects(promise,error=>error.status===status);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
test('conversation search filters are explicit, literal, trimmed and bounded',()=>{
 assert.deepEqual(parseChatSearchQuery(new URLSearchParams({tenantId,conversationId,query:'  %_ O\'Reilly  '})),{tenantId,conversationId,query:'%_ O\'Reilly',limit:50});
 for(const extra of [{query:''},{query:' \t\n '},{query:'x'.repeat(101)},{limit:'0'},{limit:'101'},{limit:'1) OR true'},{allCompanies:'true'},{cursor:'unsafe()'},{conversationId:'invalid'}])assert.throws(()=>parseChatSearchQuery(new URLSearchParams({tenantId,conversationId,query:'inspection',...extra})),e=>e.status===400);
 assert.throws(()=>parseChatSearchQuery(new URLSearchParams(`tenantId=${tenantId}&conversationId=${conversationId}&query=a&query=b`)),e=>e.status===400);
});
test('opaque cursor retains bigint boundary and rejects malformed/injected/overflow grammar',()=>{
 assert.deepEqual(decodeChatSearchCursor(encode(cursor)),cursor);
 for(const value of ['garbage','unsafe()',encode({...cursor,sequence:'9007199254740994) OR true'}),encode({...cursor,sequence:9007199254740994}),encode({...cursor,sequence:'9223372036854775808'}),encode({...cursor,sequence:'0'}),encode({...cursor,sequence:'01'}),encode({...cursor,private:'yes'})])assert.throws(()=>decodeChatSearchCursor(value),e=>e.status===400);
});
test('one signed snapshot RPC returns exact counts and string sequences without read-marking writes',async()=>{
 const f=fixture();const data=await readChatSearch(f.client,query);
 assert.equal(data.total,1505);assert.equal(data.messages[0].sequence,'9007199254740995');assert.equal(data.messages[1].sequence,'9007199254740994');assert.equal(data.messages[0].created_at,messages[0].created_at);assert.equal(data.messages[0].body,messages[0].body);
 assert.deepEqual(f.calls,[{name:'search_chat_messages',args:{target_tenant:tenantId,target_conversation:conversationId,search_query:'inspection',page_limit:2,after_message:null}},{table:'chat_conversations',fields:'id',filters:[['tenant_id',tenantId],['id',conversationId]]}]);
 const second=fixture({...result,messages:[{...messages[0],sequence:'9007199254740993'}],nextCursor:null});await readChatSearch(second.client,{...query,cursor:data.nextCursor});assert.deepEqual(second.calls[0].args.after_message,cursor);
});
test('tenant/actor/conversation/query cursor changes cannot cross current search scope',async()=>{
 for(const changed of [{tenantId:other},{actorId:other},{conversationId:other},{query:'other'}]){const f=fixture();await rejectStatus(readChatSearch(f.client,{...query,cursor:encode({...cursor,...changed})}),400);assert.equal(f.calls.length,0);}
 const newActor=fixture();newActor.client.auth.getUser=async()=>({data:{user:{id:other}},error:null});await rejectStatus(readChatSearch(newActor.client,{...query,cursor:encode(cursor)}),400);assert.equal(newActor.calls.length,0);
});
test('current denied/revoked access and unreadable data are errors, never apparent empty search',async()=>{
 for(const [code,status] of [['42501',403],['22023',400],['22P02',400],['XX000',503]]){const f=fixture(null,{code,message:'private internal diagnostics'});await assert.rejects(readChatSearch(f.client,query),e=>e.status===status&&!e.message.includes('private internal'));}
 const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await rejectStatus(readChatSearch(f.client,query),401);assert.equal(f.calls.length,0);
 assert.deepEqual((await readChatSearch(fixture({...result,total:0,messages:[],nextCursor:null}).client,query)).messages,[]);
});
test('response validation denies rounded sequences, incoherent counts, order/target and cursor corruption',async()=>{
 for(const bad of [null,{},...[-1,0.5,Number.MAX_SAFE_INTEGER+1,'1505',0].map(total=>({...result,total})),{...result,actorId:other},{...result,conversationId:other},{...result,query:'other'},{...result,messages:[{...messages[0],sequence:9007199254740995}]},{...result,messages:[{...messages[0],sequence:'bad'}]},{...result,messages:[messages[1],messages[0]]},{...result,messages:[messages[0],messages[0]]},{...result,messages:[{...messages[0],conversation_id:other}]},{...result,messages:[{...messages[0],client_id:other}]},{...result,nextCursor:{...cursor,sequence:'9007199254740993'}},{...result,nextCursor:{...cursor,actorId:other}}])await rejectStatus(readChatSearch(fixture(bad).client,query),503);
 await rejectStatus(readChatSearch(fixture(result).client,{...query,cursor:encode(cursor)}),503);
});

test('post-read RLS revocation recheck denies earlier snapshot and distinguishes recheck failure',async()=>{
 for(const access of [{data:null,error:null},{data:{id:other},error:null}]){const f=fixture(result,null,access);await rejectStatus(readChatSearch(f.client,query),403);assert.equal(f.calls[0].name,'search_chat_messages');assert.equal(f.calls[1].table,'chat_conversations');}
 const f=fixture(result,null,{data:null,error:{code:'XX000',message:'private internal failure'}});await assert.rejects(readChatSearch(f.client,query),e=>e.status===503&&!e.message.includes('private internal'));assert.equal(f.calls.length,2);
});

test('valid PostgreSQL character-length Unicode bodies remain searchable without UTF16 truncation',async()=>{
 const body='😀'.repeat(4000);const data=await readChatSearch(fixture({...result,total:1,messages:[{...messages[0],body}],nextCursor:null}).client,query);assert.equal(data.messages[0].body,body);
 await rejectStatus(readChatSearch(fixture({...result,total:1,messages:[{...messages[0],body:'😀'.repeat(4001)}],nextCursor:null}).client,query),503);
});
