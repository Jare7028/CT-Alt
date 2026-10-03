import { NextResponse } from 'next/server';
import { configured, supabase } from '../../../lib/supabase';
import { TeamTimesheetError, parseTeamTimesheetQuery, readTeamTimesheets, teamTimesheetCSVStream } from '../../../lib/team-timesheets';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  if (!configured()) return NextResponse.json({ error: 'Company sign-in is not configured yet.' }, { status: 503, headers });
  try {
    const query = parseTeamTimesheetQuery(new URL(request.url).searchParams);
    const result = await readTeamTimesheets(await supabase(), query);
    if (query.mode === 'export') return new Response(teamTimesheetCSVStream(result), { headers: { ...headers,
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="team-timesheets-${query.startDate}-${query.endDate}.csv"` } });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TeamTimesheetError ? error.message : 'Team timesheets could not be loaded.' }, { status: error instanceof TeamTimesheetError ? error.status : 503, headers });
  }
}
