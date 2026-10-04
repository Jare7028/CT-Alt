import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../lib/supabase';
import {validOrigin} from '../../../lib/request-security';
import {UpdatesError,parseUpdatesQuery,readUpdates,saveUpdate,updatesMutation} from '../../../lib/updates';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(e:unknown)=>e instanceof UpdatesError?response({error:e.message},e.status):response({error:'The update could not be confirmed. Refresh and review before another change.'},503);
export async function GET(request:Request){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{return response(await readUpdates(await supabase(),parseUpdatesQuery(new URL(request.url).searchParams)));}catch(e){return fail(e);}}
export async function POST(request:Request){if(!validOrigin(request))return response({error:'Invalid request origin.'},403);if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{const raw=await request.text();if(new TextEncoder().encode(raw).length>40960)return response({error:'Update request is too large.'},413);let value:unknown;try{value=JSON.parse(raw);}catch{return response({error:'Invalid update request.'},400);}const p=updatesMutation.safeParse(value);if(!p.success)return response({error:'Choose valid update details and at most 500 recipients.'},400);return response({saved:await saveUpdate(await supabase(),p.data)});}catch(e){return fail(e);}}
