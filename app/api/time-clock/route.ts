import { NextResponse } from 'next/server';
import { configured, supabase } from '../../../lib/supabase';
import { validOrigin } from '../../../lib/request-security';
import { TimeClockError, parseTimeClockQuery, readTimeClock, saveTimeClock, timeClockMutation } from '../../../lib/time-clock';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const failure=(error:unknown)=>error instanceof TimeClockError?response({error:error.message},error.status):response({error:'The clock request could not be confirmed. Reload and review before making another change.'},503);
export async function GET(request:Request) {
  if(!configured())return response({error:'Company sign-in is not configured yet.'},503);
  try {const query=parseTimeClockQuery(new URL(request.url).searchParams);return response(await readTimeClock(await supabase(),query));}catch(error){return failure(error);}
}
export async function POST(request:Request) {
  if(!validOrigin(request))return response({error:'Invalid request origin.'},403);
  if(!configured())return response({error:'Company sign-in is not configured yet.'},503);
  try {
    const raw=await request.text();if(new TextEncoder().encode(raw).length>4096)return response({error:'Clock request is too large.'},413);
    let value:unknown;try{value=JSON.parse(raw);}catch{return response({error:'Invalid clock request.'},400);}
    const parsed=timeClockMutation.safeParse(value);if(!parsed.success)return response({error:'Choose valid clock fields. Times are recorded by the server.'},400);
    return response({saved:await saveTimeClock(await supabase(),parsed.data)});
  }catch(error){return failure(error);}
}
