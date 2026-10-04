import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../lib/supabase';
import {SmartGroupsError,parseSmartGroupSegmentsQuery,readSmartGroupSegments} from '../../../../lib/smart-groups';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{return response(await readSmartGroupSegments(await supabase(),parseSmartGroupSegmentsQuery(new URL(request.url).searchParams)));}catch(e){return e instanceof SmartGroupsError?response({error:e.message},e.status):response({error:'Segments could not be verified.'},503);}}
