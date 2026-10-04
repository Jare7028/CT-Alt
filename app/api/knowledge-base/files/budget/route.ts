import {NextResponse} from 'next/server';
import {z} from 'zod';
import {configured,supabase} from '../../../../../lib/supabase';
import {KnowledgeFileError,fileQuery,readKnowledgeFileBudget} from '../../../../../lib/knowledge-base-files';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(e:unknown)=>e instanceof KnowledgeFileError?response({error:e.message},e.status):response({error:'File outcome could not be verified. Reconcile before another action.'},503);
export async function GET(request:Request){if(!configured())return response({error:'Company sign-in is not configured.'},503);try{const q=z.object({tenantId:z.uuid()}).strict().safeParse(fileQuery(new URL(request.url).searchParams,['tenantId']));if(!q.success)return response({error:'Choose a valid company.'},400);return response(await readKnowledgeFileBudget(await supabase(),q.data.tenantId.toLowerCase()));}catch(e){return fail(e);}}
