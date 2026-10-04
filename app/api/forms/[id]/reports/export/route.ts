import {NextResponse} from 'next/server';
import {configured, supabase} from '../../../../../../lib/supabase';
import {FormsReportingError, exportFormsReport, formsReportStream, parseFormsReportExportQuery} from '../../../../../../lib/forms-reporting';
const failure = (error: string, status: number) => NextResponse.json({error},{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request: Request, context: {params: Promise<{id:string}>}) {
  if (!configured()) return failure('Company sign-in is not configured.',503);
  try {
    const {id} = await context.params;
    const query = parseFormsReportExportQuery(new URL(request.url).searchParams,id);
    const result = await exportFormsReport(await supabase(),query);
    return new Response(formsReportStream(result.bytes),{headers:{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="${result.filename}"`,
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'X-CT-Alt-Actor-ID':result.identity.actorId,'X-CT-Alt-Company-ID':result.identity.tenantId,
      'X-CT-Alt-Form-ID':result.formId,'X-CT-Alt-Collection-Version':result.collectionVersion,
      'X-CT-Alt-Form-Revision':String(result.formRevision),'X-CT-Alt-Role':result.identity.role,
      'X-CT-Alt-Report-Kind':query.kind,
    }});
  } catch (e) {return e instanceof FormsReportingError ? failure(e.message,e.status) : failure('Forms export could not be verified.',503);}
}
