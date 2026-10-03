// Public-by-design development binding verified through CT Alt's own connector.
// Auth and RLS grant tenant access; this key does not grant privileged access.
// Complete environment pairs take precedence. Remove this development fallback
// when deployment environment management is established.
export const DEVELOPMENT_PUBLIC_CONFIG = Object.freeze({
  url: "https://clytszmnrssgvnlwfbrm.supabase.co",
  key: "sb_publishable_5sSoCnVi7mKFyxtLGYTPVg_i5fvNtz3",
});
const LOCAL_URL = 'http://127.0.0.1:54821';
type Overrides = { url?: string; key?: string };
type PublicConfig = { url: string; key: string };
export function approvedSupabaseUrl(url: string | undefined) {
  return url === DEVELOPMENT_PUBLIC_CONFIG.url || url === LOCAL_URL;
}
function localAnonymousKey(key: string) {
  try {
    const pieces = key.split('.');
    if (pieces.length !== 3) return false;
    const payload = JSON.parse(atob(pieces[1].replaceAll('-', '+').replaceAll('_', '/')));
    return payload.iss === 'supabase-demo' && payload.role === 'anon' && payload.ref === undefined;
  } catch { return false; }
}
export function resolveSupabaseConfig(overrides: Overrides): PublicConfig | null {
  const hasOverride = !!(overrides.url || overrides.key);
  const candidate = hasOverride ? overrides : DEVELOPMENT_PUBLIC_CONFIG;
  if (!approvedSupabaseUrl(candidate.url) || !candidate.key) return null;
  const modernPublic = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(candidate.key);
  if (!modernPublic && !(candidate.url === LOCAL_URL && localAnonymousKey(candidate.key))) return null;
  return { url: candidate.url!, key: candidate.key };
}
export function supabaseConfig() {
  return resolveSupabaseConfig({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
}
export function configured() { return supabaseConfig() !== null; }
