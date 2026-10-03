import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { supabaseConfig } from '../../../lib/supabase-config';
import { authOrigin, callbackCode, safeAuthDestination, validCallbackOrigin } from '../../../lib/auth-redirects';

export async function GET(request: Request) {
  const url=new URL(request.url);
  const config=supabaseConfig();
  const origin=config ? authOrigin(config) : 'https://ct-alt.vercel.app';
  const redirect=(path:string) => {
    const response=NextResponse.redirect(new URL(path,origin),303);
    response.headers.set('Cache-Control','private, no-store');
    response.headers.set('Referrer-Policy','no-referrer');
    return response;
  };
  const code=callbackCode(url.searchParams);
  // Reject wrong deployment/origin and malformed provider responses before Auth.
  if (!config || !validCallbackOrigin(request,config) || !code) return redirect('/login?error=link');
  try {
    const client=await supabase();
    const { error }=await client.auth.exchangeCodeForSession(code);
    if (error) return redirect('/login?error=link');
    const {data:{user},error:identityError}=await client.auth.getUser();
    if(identityError || !user || !user.email_confirmed_at || user.is_anonymous) {
      await client.auth.signOut();return redirect('/login?error=link');
    }
    // Authentication alone never creates a tenant or membership.
    return redirect(safeAuthDestination(url.searchParams.get('next')));
  } catch { return redirect('/login?error=link'); }
}
