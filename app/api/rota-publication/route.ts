import { NextResponse } from 'next/server';
import { configured, supabase } from '../../../lib/supabase';
import { validOrigin } from '../../../lib/request-security';
import { publishRotaShifts, readRotaPublicationBody, RotaPublicationError } from '../../../lib/rota-publication-server';
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: Request) {
  try {
    if (!validOrigin(request)) return response({ error: 'Invalid request origin.' }, 403);
    if (!configured()) return response({ error: 'Company sign-in is not configured.' }, 503);
    return response({ saved: await publishRotaShifts(await supabase(), await readRotaPublicationBody(request)) });
  } catch (error) {
    return error instanceof RotaPublicationError ? response({ error: error.message }, error.status) :
      response({ error: 'Publication could not be confirmed. Reload schedules and review.' }, 503);
  }
}
