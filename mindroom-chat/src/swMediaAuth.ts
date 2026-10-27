const MEDIA_REQUEST_PATHS = [
  '/_matrix/client/v1/media/download',
  '/_matrix/client/v1/media/thumbnail',
] as const;

const isMediaPathname = (pathname: string): boolean =>
  MEDIA_REQUEST_PATHS.some((path) => {
    const pathStart = pathname.indexOf(path);
    if (pathStart < 0) return false;
    const nextCharacter = pathname[pathStart + path.length];
    return nextCharacter === undefined || nextCharacter === '/';
  });

const isMediaPathnameForBase = (pathname: string, basePathname: string): boolean => {
  const basePath = basePathname.replace(/\/+$/, '');
  return MEDIA_REQUEST_PATHS.some((path) => {
    const expectedPath = `${basePath}${path}`;
    if (!pathname.startsWith(expectedPath)) return false;
    const nextCharacter = pathname[expectedPath.length];
    return nextCharacter === undefined || nextCharacter === '/';
  });
};

const parseUrl = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

export const looksLikeMediaRequest = (url: string): boolean => {
  const parsedUrl = parseUrl(url);
  return parsedUrl ? isMediaPathname(parsedUrl.pathname) : false;
};

export const validMediaRequest = (url: string, baseUrl: string): boolean => {
  const parsedRequestUrl = parseUrl(url);
  const parsedBaseUrl = parseUrl(baseUrl);

  if (!parsedRequestUrl || !parsedBaseUrl) return false;
  if (parsedRequestUrl.origin !== parsedBaseUrl.origin) return false;

  return isMediaPathnameForBase(parsedRequestUrl.pathname, parsedBaseUrl.pathname);
};
