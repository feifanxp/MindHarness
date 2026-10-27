import en from '../locales/en.json';

type LocaleTree = { [key: string]: string | LocaleTree };

const resolveKey = (key: string): string | undefined => {
  const value = key
    .split('.')
    .reduce<LocaleTree | string | undefined>(
      (node, part) => (typeof node === 'object' && node !== undefined ? node[part] : undefined),
      en as LocaleTree
    );
  return typeof value === 'string' ? value : undefined;
};

// Test-only stand-in for i18next's t(): resolves keys against the real
// en.json (with {{var}} interpolation and _one/_other plural suffixes for
// options.count, like i18next's English rules) so component tests keep
// asserting user-visible English copy without booting the full i18next
// runtime.
export const translateFromEn = (key: string, options?: Record<string, unknown>): string => {
  const pluralValue =
    options && typeof options.count === 'number'
      ? resolveKey(`${key}_${options.count === 1 ? 'one' : 'other'}`)
      : undefined;
  const value = pluralValue ?? resolveKey(key);
  if (value === undefined) return key;
  return value.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    options && name in options ? String(options[name]) : match
  );
};
