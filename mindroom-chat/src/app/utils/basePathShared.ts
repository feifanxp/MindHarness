import { trimLeadingSlash, trimTrailingSlash } from './common';

export const normalizeBasePath = (value?: string | null): string => {
  const raw = (value ?? '').trim();
  if (raw === '' || raw === '/' || raw === '.' || raw === './') return '/';

  const withoutTrailing = trimTrailingSlash(raw);
  const withoutLeading = trimLeadingSlash(withoutTrailing);
  if (withoutLeading === '') return '/';

  return `/${withoutLeading}`;
};
