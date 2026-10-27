import { readdirSync, readFileSync } from 'fs';
import { createInstance } from 'i18next';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  APP_LANGUAGES,
  APP_LANGUAGE_CODES,
  DEFAULT_LANGUAGE_CODE,
  normalizeDetectedLanguage,
  toSupportedLanguageCode,
} from './i18nLanguages';

const LOCALES_DIR = fileURLToPath(new URL('./locales', import.meta.url));

type LocaleTree = { [key: string]: string | LocaleTree };

const readLocale = (code: string): LocaleTree =>
  JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8'));

const collectEntries = (tree: LocaleTree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [[path, value]] : collectEntries(value, path);
  });

const interpolationPlaceholders = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
    .map((match) => match[1].replace(/\s+/g, ''))
    .sort();

const collectLeafValues = (tree: LocaleTree): string[] =>
  Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : collectLeafValues(value)
  );

const richTextBindings = (value: string): string[] => {
  const stack: string[] = [];
  const bindings: string[] = [];
  for (const match of value.matchAll(/<\/?([A-Za-z][\w-]*)[^>]*>|\{\{\s*([^}]+?)\s*\}\}/g)) {
    if (match[2]) {
      bindings.push(stack.join('/') + ':' + match[2].replace(/\s+/g, ''));
    } else if (match[0].startsWith('</')) {
      expect(stack.pop(), 'unbalanced translation markup').toBe(match[1]);
    } else if (!match[0].endsWith('/>')) {
      stack.push(match[1]);
    }
  }
  expect(stack, 'unclosed translation markup').toEqual([]);
  return bindings.sort();
};

const localeFileCodes = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''));

describe('app languages', () => {
  it('registers the default language', () => {
    expect(APP_LANGUAGE_CODES).toContain(DEFAULT_LANGUAGE_CODE);
  });

  it('has a locale file for every registered language', () => {
    APP_LANGUAGES.forEach((language) => {
      expect(localeFileCodes, `missing src/app/locales/${language.code}.json`).toContain(
        language.code
      );
    });
  });

  it('registers every locale file as a selectable language', () => {
    localeFileCodes.forEach((code) => {
      expect(APP_LANGUAGE_CODES, `src/app/locales/${code}.json is not in APP_LANGUAGES`).toContain(
        code
      );
    });
  });

  it('registers every supported language with its native name', () => {
    expect(APP_LANGUAGES).toEqual([
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
    ]);
  });
});

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const logicalKey = (path: string): string => path.replace(PLURAL_SUFFIX, '');
const markupTags = (value: string): string[] =>
  [...value.matchAll(/<\/?[A-Za-z][^>]*>/g)].map((match) => match[0].replace(/\s+/g, '')).sort();

describe('locale files', () => {
  const english = readLocale(DEFAULT_LANGUAGE_CODE);
  const enValues = new Map(collectEntries(english));
  const logicalKeys = [...new Set([...enValues.keys()].map(logicalKey))].sort();
  const pluralKeys = [
    ...new Set([...enValues.keys()].filter((path) => PLURAL_SUFFIX.test(path)).map(logicalKey)),
  ];
  const commandExamples = [...enValues.entries()].filter(
    ([path, value]) => path.startsWith('sharedUi.commands.') && value.includes('Example')
  );

  localeFileCodes.forEach((code) => {
    const locale = readLocale(code);
    const values = new Map(collectEntries(locale));

    it(`${code}.json covers every English message and every native plural category`, () => {
      expect([...new Set([...values.keys()].map(logicalKey))].sort()).toEqual(logicalKeys);
      const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
      pluralKeys.forEach((path) =>
        categories.forEach((category) => {
          expect(values.has(`${path}_${category}`), `${code}: ${path}_${category}`).toBe(true);
        })
      );
    });

    it(`${code}.json preserves interpolation and rich-text markup`, () => {
      values.forEach((value, path) => {
        const source = enValues.get(path) ?? enValues.get(`${logicalKey(path)}_other`);
        expect(source, `Unexpected translation: ${path}`).toBeDefined();
        if (source === undefined) return;
        expect(interpolationPlaceholders(value), path).toEqual(interpolationPlaceholders(source));
        expect(markupTags(value), path).toEqual(markupTags(source));
        expect(richTextBindings(value), path).toEqual(richTextBindings(source));
        for (const tag of source.matchAll(/<([A-Za-z][\w-]*)>[^<]+<\/\1>/g)) {
          expect(value, path).not.toMatch(new RegExp('<' + tag[1] + '>\\s*</' + tag[1] + '>'));
        }
      });
    });

    it(`${code}.json has no empty translations`, () => {
      collectLeafValues(locale).forEach((value) => expect(value.trim()).not.toBe(''));
    });

    it(`${code}.json preserves command examples exactly`, () => {
      expect(commandExamples).toHaveLength(12);
      commandExamples.forEach(([path, value]) => {
        const example = value.match(/\bExample:?\s*(.*)$/)?.[1];
        expect(example, path).toBeDefined();
        const translated = values.get(path)?.replace(/[\u2068\u2069]/g, '');
        if (code !== DEFAULT_LANGUAGE_CODE) expect(translated, path).not.toBe(value);
        const escapedExample = example?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(translated, path).toMatch(new RegExp(`${escapedExample}$`));
      });
    });

    it(`${code} resolves counts from its own catalog without English fallback`, async () => {
      const instance = createInstance();
      await instance.init({
        lng: code,
        fallbackLng: 'en',
        resources: { en: { translation: english }, [code]: { translation: locale } },
      });
      pluralKeys.forEach((path) => {
        [0, 1, 2, 3, 5, 11, 21, 100, 1000000].forEach((count) => {
          const category = new Intl.PluralRules(code).select(count);
          const expectedKey =
            count === 0 && values.has(`${path}_zero`) ? `${path}_zero` : `${path}_${category}`;
          // Dynamic catalog inventory deliberately exercises the real i18next resolver.
          const result = instance.t(path, { count, returnDetails: true, defaultValue: '' });
          expect(result.usedLng, `${code}: ${path} at ${count}`).toBe(code);
          expect(result.exactUsedKey, `${code}: ${path} at ${count}`).toBe(expectedKey);
          expect(result.res).not.toBe('');
        });
      });
    });
  });
});

describe('toSupportedLanguageCode', () => {
  it('keeps supported codes', () => {
    expect(toSupportedLanguageCode('de')).toBe('de');
  });

  it('reduces regional variants to their base language', () => {
    expect(toSupportedLanguageCode('de-AT')).toBe('de');
    expect(toSupportedLanguageCode('de_AT')).toBe('de');
    expect(toSupportedLanguageCode('EN-US')).toBe('en');
    expect(toSupportedLanguageCode('EN_US')).toBe('en');
    expect(toSupportedLanguageCode('nl-BE')).toBe('nl');
    expect(toSupportedLanguageCode('ES_mx')).toBe('es');
    expect(toSupportedLanguageCode('pt-BR')).toBe('pt');
    expect(toSupportedLanguageCode('ar-SA')).toBe('ar');
  });

  it('maps Chinese script and region variants to the matching catalog', () => {
    expect(toSupportedLanguageCode('zh-TW')).toBe('zh-TW');
    expect(toSupportedLanguageCode('ZH_tw.UTF-8')).toBe('zh-TW');
    expect(toSupportedLanguageCode('zh-Hant-HK')).toBe('zh-TW');
    expect(toSupportedLanguageCode('zh-HK')).toBe('zh-TW');
    expect(toSupportedLanguageCode('zh-CN')).toBe('zh');
    expect(toSupportedLanguageCode('zh-Hans-TW')).toBe('zh');
  });

  it('falls back to the default language for unsupported or missing codes', () => {
    expect(toSupportedLanguageCode('zz')).toBe(DEFAULT_LANGUAGE_CODE);
    expect(toSupportedLanguageCode(undefined)).toBe(DEFAULT_LANGUAGE_CODE);
    expect(toSupportedLanguageCode('')).toBe(DEFAULT_LANGUAGE_CODE);
  });

  it('normalizes supported browser preferences without masking later preferences', () => {
    expect(normalizeDetectedLanguage('zh-Hant-HK')).toBe('zh-TW');
    expect(normalizeDetectedLanguage('PT_br.UTF-8')).toBe('pt');
    expect(normalizeDetectedLanguage('zz-ZZ')).toBe('zz-ZZ');
  });
});

describe('configured i18n runtime', () => {
  const attributes = new Map<string, string>();
  const documentElement = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
  let runtime: typeof import('./i18n').default;

  beforeAll(async () => {
    vi.stubGlobal('document', { documentElement });
    runtime = (await import('./i18n')).default;
  });

  afterEach(async () => {
    await runtime.changeLanguage('en');
    runtime.removeResourceBundle('ar', 'translation');
    runtime.removeResourceBundle('zh-TW', 'translation');
  });

  afterAll(() => vi.unstubAllGlobals());

  it('keeps English bundled while other locales load lazily', () => {
    expect(Object.keys(runtime.options.resources ?? {})).toEqual(['en']);
    expect(runtime.options.react?.useSuspense).toBe(false);
  });

  it('updates translations and document language metadata without a remount', async () => {
    const originalDocumentElement = documentElement;
    runtime.addResourceBundle(
      'ar',
      'translation',
      { settings: { general: { language: { appLanguage: 'لغة التطبيق' } } } },
      true,
      true
    );

    await runtime.changeLanguage('ar');

    expect(runtime.t('settings.general.language.appLanguage')).toBe('لغة التطبيق');
    expect(runtime.t('settings.general.language.sectionTitle')).toBe('Language');
    expect(document.documentElement).toBe(originalDocumentElement);
    expect(attributes.get('lang')).toBe('ar');
    expect(attributes.get('dir')).toBe('rtl');
  });

  it('preserves Traditional Chinese through a real language change', async () => {
    runtime.addResourceBundle(
      'zh-TW',
      'translation',
      { settings: { general: { language: { appLanguage: '應用程式語言' } } } },
      true,
      true
    );

    await runtime.changeLanguage('zh-TW');

    expect(runtime.resolvedLanguage).toBe('zh-TW');
    expect(runtime.t('settings.general.language.appLanguage')).toBe('應用程式語言');
    expect(attributes.get('lang')).toBe('zh-TW');
    expect(attributes.get('dir')).toBe('ltr');
  });
});
