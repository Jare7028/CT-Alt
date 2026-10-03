export function validOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'https:' : url.protocol;
  return origin === `${protocol}//${host}`;
}
