import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { settingsModalAtom } from '../../state/settingsModal';
import { SettingsPages } from './settingsPages';
import { SettingsModalRenderer } from './SettingsModalRenderer';

vi.mock('../../components/Modal500', () => ({
  Modal500: ({
    children,
    requestClose,
  }: {
    children: React.ReactNode;
    requestClose: () => void;
  }) => React.createElement('div', { 'data-testid': 'settings-modal', requestClose }, children),
}));

vi.mock('./Settings', () => ({
  Settings: ({
    initialPage,
    requestClose,
  }: {
    initialPage?: import('./settingsPages').SettingsPage;
    requestClose: () => void;
  }) =>
    React.createElement('div', {
      'data-testid': 'settings-view',
      'data-initial-page': initialPage,
      requestClose,
    }),
}));

describe('SettingsModalRenderer', () => {
  it('renders the shared settings modal state and closes by clearing it', async () => {
    const store = createStore();
    store.set(settingsModalAtom, {
      initialPage: SettingsPages.DevicesPage,
    });

    const renderer = create(
      React.createElement(
        Provider,
        { store },
        React.createElement(SettingsModalRenderer)
      )
    );

    const settingsView = renderer.root.findByProps({ 'data-testid': 'settings-view' });
    expect(settingsView.props['data-initial-page']).toBe(SettingsPages.DevicesPage);

    await act(async () => {
      settingsView.props.requestClose();
    });

    expect(store.get(settingsModalAtom)).toBeUndefined();
    expect(renderer.root.findAllByProps({ 'data-testid': 'settings-modal' })).toHaveLength(0);
  });
});
