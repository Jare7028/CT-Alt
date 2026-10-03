import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../lib/supabase';
import {QuickTaskError,parseQuickTaskAssigneesQuery,readQuickTaskAssignees} from '../../../../lib/quick-tasks';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{return response(await readQuickTaskAssignees(await supabase(),parseQuickTaskAssigneesQuery(new URL(request.url).searchParams)));}catch(error){return error instanceof QuickTaskError?response({error:error.message},error.status):response({error:'Assignable users could not be loaded.'},503);}}
