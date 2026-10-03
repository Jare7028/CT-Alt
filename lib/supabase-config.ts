// Explicit project boundary: an inherited environment from another application
// must never send Auth or database traffic outside CT Alt's own resources.
export function approvedSupabaseUrl(url: string | undefined) {
  return url === 'https://clytszmnrssgvnlwfbrm.supabase.co' || url === 'http://127.0.0.1:54821';
}
export function configured() {
  return approvedSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}
