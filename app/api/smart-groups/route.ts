import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../lib/supabase';
import {validOrigin} from '../../../lib/request-security';
import {SmartGroupsError,parseSmartGroupsQuery,readSmartGroups,saveSmartGroup,smartGroupMutation} from '../../../lib/smart-groups';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(e:unknown)=>e instanceof SmartGroupsError?response({error:e.message},e.status):response({error:'Smart Groups could not be verified. Refresh and review before another change.'},503);
export async function GET(request:Request){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{return response(await readSmartGroups(await supabase(),parseSmartGroupsQuery(new URL(request.url).searchParams)));}catch(e){return fail(e);}}
export async function POST(request:Request){if(!validOrigin(request))return response({error:'Invalid request origin.'},403);if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{const raw=await request.text();if(new TextEncoder().encode(raw).length>40960)return response({error:'Group request is too large.'},413);let value:unknown;try{value=JSON.parse(raw);}catch{return response({error:'Invalid group request.'},400);}const p=smartGroupMutation.safeParse(value);if(!p.success)return response({error:'Choose valid group details and rules.'},400);return response({saved:await saveSmartGroup(await supabase(),p.data)});}catch(e){return fail(e);}}
