type Config = { url: string; key: string };
export function authOrigin(config: Config) {
  return config.url === 'http://127.0.0.1:54821' ? 'http://127.0.0.1:5180' : 'https://ct-alt.vercel.app';
}
export function callbackUrl(config: Config) { return authOrigin(config) + '/auth/callback'; }
export function safeAuthDestination(next: string | null) {
  // No caller-controlled host, query, encoded path or protocol is redirected to.
  return next === '/agents' ? next : '/agents';
}
export function callbackCode(params: URLSearchParams) {
  const codes=params.getAll('code');
  return codes.length===1 && /^[A-Za-z0-9_-]{16,2048}$/.test(codes[0]) && !params.has('error') ? codes[0] : null;
}

export function validCallbackOrigin(request: Request, config: Config) {
  const expected=new URL(authOrigin(config));
  // Next.js may use an internal localhost URL behind the server/proxy.
  // Require the actual Host and the expected protocol, never a redirect host.
  const protocol=request.headers.get('x-forwarded-proto')==='https' ? 'https:' : new URL(request.url).protocol;
  return request.headers.get('host')===expected.host && protocol===expected.protocol;
}
