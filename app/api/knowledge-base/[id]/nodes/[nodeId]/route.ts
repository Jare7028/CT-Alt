import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../../../lib/supabase';
import {KnowledgeBaseError,readKnowledgeNode,parseKnowledgeNodeQuery} from '../../../../../../lib/knowledge-base';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(e:unknown)=>e instanceof KnowledgeBaseError?response({error:e.message},e.status):response({error:'Knowledge Base could not be verified. Refresh and review before another action.'},503);
export async function GET(request:Request,context:{params:Promise<{id:string;nodeId:string}>}){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{const p=await context.params;return response(await readKnowledgeNode(await supabase(),parseKnowledgeNodeQuery(new URL(request.url).searchParams,p.id,p.nodeId)));}catch(e){return fail(e);}}
