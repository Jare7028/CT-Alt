import {NextResponse} from 'next/server';
import {configured, supabase} from '../../../../../lib/supabase';
import {FormsReportingError, parseFormsReportQuery, readFormsReport} from '../../../../../lib/forms-reporting';
const response = (data: unknown, status = 200) => NextResponse.json(data, {status, headers: {'Cache-Control':'private, no-store'}});
export async function GET(request: Request, context: {params: Promise<{id:string}>}) {
  if (!configured()) return response({error:'Company sign-in is not configured.'},503);
  try {
    const {id} = await context.params;
    return response(await readFormsReport(await supabase(),parseFormsReportQuery(new URL(request.url).searchParams,id)));
  } catch (e) {return e instanceof FormsReportingError ? response({error:e.message},e.status) : response({error:'Forms reporting could not be verified.'},503);}
}
