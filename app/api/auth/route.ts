import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { configured, supabase } from '../../../lib/supabase';
import { supabaseConfig } from '../../../lib/supabase-config';
import { authOrigin, callbackUrl } from '../../../lib/auth-redirects';
import { validOrigin } from '../../../lib/request-security';

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), email: z.email().max(254), password: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('email_link'), email: z.email().max(254) }).strict(),
  z.object({ action: z.literal('logout') }).strict(),
]);
const response=(data:unknown,status=200,headers:Record<string,string>={})=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store',...headers}});
const emailResult=()=>response({message:'If email sign-in is available for this address, a link will arrive shortly. Wait a minute before requesting another link.',retryAfter:60},202,{'Retry-After':'60'});

export async function POST(request: Request) {
  if (!validOrigin(request)) return response({ error: 'Invalid request origin.' },403);
  if (!configured()) return response({ error: 'Company sign-in is not configured yet.' },503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 2000) return response({ error: 'Request is too large.' },413);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return response({ error: 'Invalid request.' },400); }
  const parsed = input.safeParse(json);
  if (!parsed.success) return response({ error: 'Enter valid sign-in details.' },400);
  if(parsed.data.action==='email_link') {
    const config=supabaseConfig()!;
    // Preview domains cannot use the production callback's PKCE cookie. Reject
    // before sending, rather than sending an unusable cross-domain email link.
    if(request.headers.get('origin')!==authOrigin(config))return response({error:'Use the main CT Alt address to request an email link.'},400);
    const jar=await cookies();
    const cooldown=Number(jar.get('ct-alt-email-cooldown')?.value || 0);
    if(Number.isFinite(cooldown) && cooldown>Date.now())return emailResult();
    // This browser cooldown helps ordinary retries. Supabase supplies the
    // authoritative per-address/service limits, including across instances.
    jar.set('ct-alt-email-cooldown',String(Date.now()+60000),{httpOnly:true,secure:config.url.startsWith('https:'),sameSite:'strict',maxAge:60,path:'/api/auth'});
    try {
      const client=await supabase();
      await client.auth.signInWithOtp({email:parsed.data.email,options:{shouldCreateUser:true,emailRedirectTo:callbackUrl(config)}});
    } catch { /* Same response for delivery errors, rate limits and eligibility. */ }
    // Never reveal account existence, provider error text or delivery status.
    return emailResult();
  }
  const client = await supabase();
  const { error } = parsed.data.action === 'logout'
    ? await client.auth.signOut()
    : await client.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  return response(error ? { error: 'Sign-in failed. Check your details and try again.' } : { ok: true },error ? 401 : 200);
}
