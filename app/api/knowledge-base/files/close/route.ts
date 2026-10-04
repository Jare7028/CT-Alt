import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../../lib/supabase';
import {validOrigin} from '../../../../../lib/request-security';
import {KnowledgeFileError,boundedBody,fileJson,knowledgeFileAttemptChange,closeKnowledgeFile} from '../../../../../lib/knowledge-base-files';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(e:unknown)=>e instanceof KnowledgeFileError?response({error:e.message},e.status):response({error:'File outcome could not be verified. Reconcile before another action.'},503);
export async function POST(request:Request){if(!validOrigin(request))return response({error:'Invalid request origin.'},403);if(!configured())return response({error:'Company sign-in is not configured.'},503);try{const input=knowledgeFileAttemptChange.safeParse(fileJson((await boundedBody(request,16384)).toString()));if(!input.success)return response({error:'Choose valid file operation details.'},400);const value=await closeKnowledgeFile(await supabase(),input.data);return response(value);}catch(e){return fail(e);}}
