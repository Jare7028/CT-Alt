import { NextResponse } from 'next/server';
import { configured, supabase } from '../../../lib/supabase';
import { OverviewReadError, parseActivityQuery, readActivity } from '../../../lib/workforce-overview';

const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: Request) {
  if (!configured()) return response({ error: 'Company sign-in is not configured yet.' }, 503);
  try {
    const parsed = parseActivityQuery(new URL(request.url).searchParams);
    const client = await supabase();
    return response(await readActivity(client, parsed.tenantId, parsed.filters));
  } catch (error) {
    return error instanceof OverviewReadError ? response({ error: error.message }, error.status) : response({ error: 'Activity could not be loaded.' }, 503);
  }
}
