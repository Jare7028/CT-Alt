import { supabaseConfig } from './lib/supabase-config';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = supabaseConfig();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { name: 'ct-alt-auth', httpOnly: true, secure: config.url.startsWith('https:') },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: values => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      },
    },
  });
  await client.auth.getUser();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/smart-groups/:path*', '/agents/:path*', '/rotas/:path*', '/chat/:path*', '/quick-tasks/:path*', '/updates/:path*', '/time-off/:path*', '/time-clock/:path*', '/overview/:path*', '/activity/:path*', '/api/:path*', '/login'] };
