import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import Backend, { HttpBackendOptions } from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';
import { appUrl } from './utils/basePath';
import { APP_LANGUAGE_CODES, normalizeDetectedLanguage } from './i18nLanguages';
import en from './locales/en.json';
import { syncDayjsLocale } from './appLocale';

i18n
  // i18next-http-backend
  // loads translations from your server
  // https://github.com/i18next/i18next-http-backend
  .use(Backend)
  // detect user language
  // learn more: https://github.com/i18next/i18next-browser-languageDetector
  .use(LanguageDetector)
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init<HttpBackendOptions>({
    debug: false,
    fallbackLng: 'en',
    supportedLngs: APP_LANGUAGE_CODES,
    detection: {
      convertDetectedLanguage: normalizeDetectedLanguage,
    },
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    // Detection normalizes ordinary regions to their base catalog while
    // retaining zh-TW, so i18next must not collapse the canonical variant.
    load: 'currentOnly',
    // English ships in the bundle so the UI never renders bare keys while the
    // async locale fetch is in flight; other languages load on demand.
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    // The app has no Suspense boundary around the router; suspending on a
    // language switch would blank the whole UI. Components re-render once the
    // requested locale finishes loading instead.
    react: { useSuspense: false },
    backend: {
      loadPath: appUrl('public/locales/{{lng}}.json'),
    },
  });

// i18next reports locale-fetch failures through this event rather than by
// rejecting the changeLanguage() promise — without a listener a failed
// de.json/nl.json request would silently leave the UI on the fallback language.
i18n.on('failedLoading', (lng, ns, msg) => {
  // eslint-disable-next-line no-console
  console.error(`[i18n] failed loading locale "${lng}" (namespace "${ns}"): ${msg}`);
});

const syncDocumentLanguage = (language: string) => {
  const languageCode = syncDayjsLocale(language);
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', languageCode);
  document.documentElement.setAttribute('dir', i18n.dir(languageCode));
};

i18n.on('languageChanged', syncDocumentLanguage);
if (i18n.resolvedLanguage) syncDocumentLanguage(i18n.resolvedLanguage);

export default i18n;
