import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {
    simpleMode: false,
    showCanvasesInSidebar: true,
  },
  clientConfig: {} as { mindroom?: { canvas?: { enabled?: boolean } } },
  setAccountSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useClientConfig', () => ({ useClientConfig: () => state.clientConfig }));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children, ...rest }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', rest, children),
    Switch: ({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) =>
      reactModule.createElement('button', {
        'aria-pressed': value,
        onClick: () => onChange(!value),
      }),
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    color: { Critical: { Main: 'red' } },
  };
});

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    after,
    children,
  }: {
    title: string;
    description?: string;
    after?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      'label',
      {
        'data-title': title,
        'data-description': description,
      },
      after,
      children
    ),
}));

vi.mock('./useMindroomAccountSettings', () => ({
  useMindroomAccountSettings: () => state.settings,
  useSetMindroomAccountSettings: () => state.setAccountSettings,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

afterEach(() => {
  state.settings.simpleMode = false;
  state.settings.showCanvasesInSidebar = true;
  state.clientConfig = {};
  state.setAccountSettings.mockReset();
  state.setAccountSettings.mockResolvedValue(undefined);
});

describe('MindroomInterfaceSettings', () => {
  it('offers the sidebar Canvases button only where the deployment has canvases', async () => {
    const { MindroomInterfaceSettings } = await import('./MindroomInterfaceSettings');
    const title = { 'data-title': 'Show Canvases in the sidebar' };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(MindroomInterfaceSettings));
    });
    expect(renderer.root.findAllByProps(title)).toHaveLength(0);

    state.clientConfig = { mindroom: { canvas: { enabled: true } } };
    act(() => {
      renderer.update(React.createElement(MindroomInterfaceSettings));
    });
    const tile = renderer.root.findByProps(title);
    expect(tile.findByType('button').props['aria-pressed']).toBe(true);
    await act(async () => {
      tile.findByType('button').props.onClick();
    });
    expect(state.setAccountSettings).toHaveBeenCalledWith({ showCanvasesInSidebar: false });
  });
});
