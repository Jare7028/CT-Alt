import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../lib/supabase';
import {KnowledgeBaseError,readKnowledgeAssignees,parseKnowledgeAssigneesQuery} from '../../../../lib/knowledge-base';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(e:unknown)=>e instanceof KnowledgeBaseError?response({error:e.message},e.status):response({error:'Knowledge Base could not be verified. Refresh and review before another action.'},503);
export async function GET(request:Request){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{return response(await readKnowledgeAssignees(await supabase(),parseKnowledgeAssigneesQuery(new URL(request.url).searchParams)));}catch(e){return fail(e);}}
