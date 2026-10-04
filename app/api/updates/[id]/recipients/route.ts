import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../../lib/supabase';
import {UpdatesError,readUpdateRecipients,parseUpdateRecipientsQuery} from '../../../../../lib/updates';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request,context:{params:Promise<{id:string}>}){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{return response(await readUpdateRecipients(await supabase(),parseUpdateRecipientsQuery(new URL(request.url).searchParams,(await context.params).id)));}catch(e){return e instanceof UpdatesError?response({error:e.message},e.status):response({error:'Updates could not be loaded. Try again.'},503);}}
