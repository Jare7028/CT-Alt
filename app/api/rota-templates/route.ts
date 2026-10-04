import { NextResponse } from 'next/server';
import { configured, supabase } from '../../../lib/supabase';
import { validOrigin } from '../../../lib/request-security';
import { parseRotaTemplateQuery, readRotaTemplates, readRotaTemplateBody, saveRotaTemplate, reconcileRotaTemplate, rotaTemplateRecoveryMutation, RotaTemplateError } from '../../../lib/rota-template-server';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
function failure(e:unknown){return e instanceof RotaTemplateError?response({error:e.message},e.status):response({error:'Templates are unavailable. Refresh and review.'},503);}
export async function GET(request:Request){try{if(!configured())return response({error:'Company sign-in is not configured.'},503);return response(await readRotaTemplates(await supabase(),parseRotaTemplateQuery(new URL(request.url).searchParams)));}catch(e){return failure(e);}}
export async function POST(request:Request){try{if(!validOrigin(request))return response({error:'Invalid request origin.'},403);if(!configured())return response({error:'Company sign-in is not configured.'},503);const value=await readRotaTemplateBody(request),client=await supabase();if(value&&typeof value==='object'&&'mode'in value){const p=rotaTemplateRecoveryMutation.safeParse(value);if(!p.success)throw new RotaTemplateError('Choose a valid template recovery operation.',400);return response(await reconcileRotaTemplate(client,p.data));}return response({saved:await saveRotaTemplate(client,value)});}catch(e){return failure(e);}}
