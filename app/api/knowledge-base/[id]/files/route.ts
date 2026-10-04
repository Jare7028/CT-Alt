import {NextResponse} from 'next/server';
import {z} from 'zod';
import {configured,supabase} from '../../../../../lib/supabase';
import {validOrigin} from '../../../../../lib/request-security';
import {KnowledgeFileError,parseKnowledgeFileUpload,uploadKnowledgeFile} from '../../../../../lib/knowledge-base-files';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(e:unknown)=>e instanceof KnowledgeFileError?response({error:e.message},e.status):response({error:'File outcome could not be verified. Reconcile before another action.'},503);
export async function POST(request:Request,context:{params:Promise<{id:string}>}){if(!validOrigin(request))return response({error:'Invalid request origin.'},403);if(!configured())return response({error:'Company sign-in is not configured.'},503);try{const{id}=await context.params;const base=z.uuid().safeParse(id);if(!base.success)return response({error:'Choose a valid Knowledge Base.'},400);return response({saved:await uploadKnowledgeFile(await supabase(),await parseKnowledgeFileUpload(request,base.data))});}catch(e){return fail(e);}}
