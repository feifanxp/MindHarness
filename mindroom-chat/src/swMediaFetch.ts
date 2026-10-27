const normalizeRequestCache = (request: Request): RequestCache =>
  request.cache === 'only-if-cached' ? 'default' : request.cache;

export const buildAuthenticatedMediaRequestInit = (
  request: Request,
  token: string
): RequestInit => {
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const cache = normalizeRequestCache(request);

  if (request.mode === 'no-cors') {
    return {
      method: request.method,
      headers,
      mode: 'cors',
      credentials: 'same-origin',
      cache,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
    };
  }

  return { headers, cache };
};
