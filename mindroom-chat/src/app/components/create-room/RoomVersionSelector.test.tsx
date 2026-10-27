import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { RoomVersionSelector } from './RoomVersionSelector';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => <button type="button">{children}</button>,
  config: { space: { S200: '8px', S300: '12px' } },
  Icon: () => null,
  Icons: { ChevronBottom: 'down', ChevronTop: 'up' },
  Menu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PopOut: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  toRem: (value: number) => `${value / 16}rem`,
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../setting-tile', () => ({
  SettingTile: ({ title, after }: { title: string; after?: React.ReactNode }) => (
    <section data-title={title}>{after}</section>
  ),
}));
vi.mock('../sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

describe('RoomVersionSelector', () => {
  it('updates its setting title after a language change', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        en: { translation: { sharedUi: { roomVersionSelector: { version: 'Version' } } } },
        es: { translation: { sharedUi: { roomVersionSelector: { version: 'Versión' } } } },
      },
    });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <RoomVersionSelector versions={['1']} value="1" onChange={() => undefined} />
        </I18nextProvider>
      );
    });

    expect(renderer!.root.findByType('section').props['data-title']).toBe('Version');
    await act(async () => {
      await language.changeLanguage('es');
    });
    expect(renderer!.root.findByType('section').props['data-title']).toBe('Versión');
  });
});
