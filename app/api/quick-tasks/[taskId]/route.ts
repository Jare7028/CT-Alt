import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../lib/supabase';
import {QuickTaskError,readQuickTask} from '../../../../lib/quick-tasks';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request,{params}:{params:Promise<{taskId:string}>}){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{const query=new URL(request.url).searchParams;if([...query.keys()].some(key=>key!=='tenantId')||query.getAll('tenantId').length!==1)return response({error:'Choose a company.'},400);return response(await readQuickTask(await supabase(),query.get('tenantId')!, (await params).taskId));}catch(error){return error instanceof QuickTaskError?response({error:error.message},error.status):response({error:'Task details could not be loaded.'},503);}}
