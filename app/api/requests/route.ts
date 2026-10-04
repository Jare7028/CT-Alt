import { NextResponse } from 'next/server';
import { configured, supabase } from '../../../lib/supabase';
import { validOrigin } from '../../../lib/request-security';
import { RequestsError, parseRequestsQuery, readRequests, requestsReadBody, requestsMutation, requestsReconcileMutation, saveRequest, reconcileRequest } from '../../../lib/requests-server';
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const fail = (e: unknown) => e instanceof RequestsError ? response({ error: e.message }, e.status) : response({ error: 'Requests could not be verified. Refresh and review.' }, 503);
export async function GET(request: Request) { if (!configured())
    return response({ error: 'Company sign-in is not configured.' }, 503); try {
    return response(await readRequests(await supabase(), parseRequestsQuery(new URL(request.url).searchParams)));
}
catch (e) {
    return fail(e);
} }
export async function POST(request: Request) { if (!validOrigin(request))
    return response({ error: 'Invalid request origin.' }, 403); if (!configured())
    return response({ error: 'Company sign-in is not configured.' }, 503); try {
    const body = await requestsReadBody(request);
    if (body !== null && typeof body === 'object' && 'mode' in body) {
        const p = requestsReconcileMutation.safeParse(body);
        if (!p.success)
            return response({ error: 'Choose a valid recovery operation.' }, 400);
        return response(await reconcileRequest(await supabase(), p.data));
    }
    const p = requestsMutation.safeParse(body);
    if (!p.success)
        return response({ error: 'Choose valid request details.' }, 400);
    return response({ saved: await saveRequest(await supabase(), p.data) });
}
catch (e) {
    return fail(e);
} }
