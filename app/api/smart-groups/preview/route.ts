import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../lib/supabase';
import {validOrigin} from '../../../../lib/request-security';
import {SmartGroupsError,previewSmartGroup,smartGroupPreview} from '../../../../lib/smart-groups';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request){if(!validOrigin(request))return response({error:'Invalid request origin.'},403);if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{const raw=await request.text();if(new TextEncoder().encode(raw).length>40960)return response({error:'Group preview is too large.'},413);let value:unknown;try{value=JSON.parse(raw);}catch{return response({error:'Invalid preview request.'},400);}const p=smartGroupPreview.safeParse(value);if(!p.success)return response({error:'Choose valid group rules and filters.'},400);return response(await previewSmartGroup(await supabase(),p.data));}catch(e){return e instanceof SmartGroupsError?response({error:e.message},e.status):response({error:'Rule preview could not be verified.'},503);}}
