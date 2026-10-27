import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('i18n HTTP backend', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a locale below the configured application subpath', async () => {
    vi.stubGlobal('__APP_BASE_PATH__', '/mindroom');
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ settings: { general: { language: { appLanguage: 'Idioma' } } } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { default: i18n } = await import('./i18n');
    if (!i18n.isInitialized) {
      await new Promise<void>((resolve) => {
        i18n.on('initialized', () => resolve());
      });
    }
    await i18n.changeLanguage('es');

    expect(fetchMock).toHaveBeenCalledWith(
      '/mindroom/public/locales/es.json',
      expect.objectContaining({ method: 'GET' })
    );
    expect(i18n.t('settings.general.language.appLanguage')).toBe('Idioma');
  });
});
