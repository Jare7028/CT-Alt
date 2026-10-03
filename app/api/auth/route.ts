import { NextResponse } from 'next/server';
import { z } from 'zod';
import { configured, supabase } from '../../../lib/supabase';
import { validOrigin } from '../../../lib/request-security';

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), email: z.email().max(254), password: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('logout') }).strict(),
]);
export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  if (!configured()) return NextResponse.json({ error: 'Company sign-in is not configured yet.' }, { status: 503 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 2000) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const parsed = input.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  const client = await supabase();
  const { error } = parsed.data.action === 'logout'
    ? await client.auth.signOut()
    : await client.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  return NextResponse.json(error ? { error: 'Sign-in failed. Check your details and try again.' } : { ok: true }, { status: error ? 401 : 200, headers: { 'Cache-Control': 'private, no-store' } });
}
