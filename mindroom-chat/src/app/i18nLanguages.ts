export type AppLanguage = {
  code: string;
  // Shown untranslated in the language picker so every user can find
  // their own language regardless of the currently active one.
  nativeName: string;
};

export const APP_LANGUAGES: AppLanguage[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'nl', nativeName: 'Nederlands' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'it', nativeName: 'Italiano' },
  { code: 'zh', nativeName: '简体中文' },
  { code: 'zh-TW', nativeName: '繁體中文' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'hi', nativeName: 'हिन्दी' },
  { code: 'ar', nativeName: 'العربية' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'tr', nativeName: 'Türkçe' },
  { code: 'id', nativeName: 'Bahasa Indonesia' },
  { code: 'bn', nativeName: 'বাংলা' },
];

export const APP_LANGUAGE_CODES: string[] = APP_LANGUAGES.map((language) => language.code);

export const DEFAULT_LANGUAGE_CODE = 'en';

const toOptionalSupportedLanguageCode = (language: string | undefined): string | undefined => {
  if (!language) return undefined;

  // Accept browser BCP-47 tags and stored POSIX variants such as ES_mx or
  // zh_TW.UTF-8 without allowing encoding/modifier suffixes to affect matching.
  const subtags = language
    .trim()
    .split(/[.@]/, 1)[0]
    .replace(/_/g, '-')
    .split('-')
    .filter(Boolean)
    .map((subtag) => subtag.toLowerCase());
  const [baseCode] = subtags;
  if (!baseCode) return undefined;

  if (baseCode === 'zh') {
    if (subtags.includes('hant')) return 'zh-TW';
    if (subtags.includes('hans')) return 'zh';
    return subtags.some((subtag) => subtag === 'tw' || subtag === 'hk' || subtag === 'mo')
      ? 'zh-TW'
      : 'zh';
  }

  return APP_LANGUAGE_CODES.find((code) => code.toLowerCase() === baseCode);
};

export const toSupportedLanguageCode = (language: string | undefined): string => {
  return toOptionalSupportedLanguageCode(language) ?? DEFAULT_LANGUAGE_CODE;
};

export const normalizeDetectedLanguage = (language: string): string =>
  toOptionalSupportedLanguageCode(language) ?? language;
