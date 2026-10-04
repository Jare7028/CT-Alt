import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../lib/supabase';
import {UpdatesError,readUpdatesRoster,parseUpdatesRosterQuery} from '../../../../lib/updates';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{return response(await readUpdatesRoster(await supabase(),parseUpdatesRosterQuery(new URL(request.url).searchParams)));}catch(e){return e instanceof UpdatesError?response({error:e.message},e.status):response({error:'Updates could not be loaded. Try again.'},503);}}
