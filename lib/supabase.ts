import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { configured } from './supabase-config';
export { configured } from './supabase-config';

export async function supabase() {
  if (!configured()) throw new Error('Company sign-in is not configured yet.');
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { name: 'ct-alt-auth' },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: values => {
        try { for (const { name, value, options } of values) jar.set(name, value, options); }
        catch { /* Server-component requests refresh through proxy.ts. */ }
      },
    },
  });
}
