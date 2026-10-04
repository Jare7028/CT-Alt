import {NextResponse} from 'next/server';
import {configured,supabase} from '../../../../../lib/supabase';
import {SmartGroupsError,parseSmartGroupMembersQuery,readSmartGroupMembers} from '../../../../../lib/smart-groups';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){if(!configured())return response({error:'Company sign-in is not configured yet.'},503);try{const{id}=await params;return response(await readSmartGroupMembers(await supabase(),parseSmartGroupMembersQuery(new URL(request.url).searchParams,id)));}catch(e){return e instanceof SmartGroupsError?response({error:e.message},e.status):response({error:'Group members could not be verified.'},503);}}
