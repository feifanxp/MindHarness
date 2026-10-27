import React from 'react';
import { create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider, Trans } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';

describe('auth account links', () => {
  it.each([
    ['sharedUi.login.accountLink', 'Register'],
    ['sharedUi.register.accountLink', 'Login'],
    ['sharedUi.resetPassword.accountLink', 'Login'],
  ])('renders the translated %s action inside its anchor', async (i18nKey, action) => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });

    const renderer = create(
      <I18nextProvider i18n={language}>
        <Trans i18nKey={i18nKey} components={{ authLink: <a href="/login">Account action</a> }} />
      </I18nextProvider>
    );

    const link = renderer.root.findByType('a');
    expect(link.props.href).toBe('/login');
    expect(link.children).toEqual([action]);
  });
});
