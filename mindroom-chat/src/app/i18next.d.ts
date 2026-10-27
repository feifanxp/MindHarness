import en from './locales/en.json';

// Typed translation keys: a typo in a t('…') key fails `npm run typecheck`
// instead of silently rendering the raw key. en.json is the schema; the
// i18n.test.ts parity test holds every other locale to the same key set.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof en;
    };
  }
}
