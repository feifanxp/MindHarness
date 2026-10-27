// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OfflineRoomController,
  OfflineRoomSnapshot,
} from '../../../mindroom/engine/roomOffline';
import type { MindroomSyncEngine } from '../../../mindroom/engine/types';
import { MindroomSyncEngineProvider } from '../../../mindroom/engine/engineContext';
import { OfflineRoomSettings } from './OfflineRoomSettings';

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('folds', () => ({
  Box: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  Button: ({
    children,
    before,
    ...props
  }: {
    children?: React.ReactNode;
    before?: React.ReactNode;
  }) => React.createElement('button', props, before, children),
  Icon: () => null,
  IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children),
  Icons: { Cross: 'cross' },
  Overlay: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? React.createElement('div', { role: 'presentation' }, children) : null,
  OverlayBackdrop: () => React.createElement('div'),
  OverlayCenter: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  Spinner: () => React.createElement('i'),
  Switch: ({
    value,
    onChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) =>
    React.createElement('input', {
      type: 'checkbox',
      checked: value,
      disabled,
      'aria-label': ariaLabel,
      onChange: () => onChange(!value),
    }),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
  color: { Critical: { Main: 'red' } },
  config: { borderWidth: { B300: '1px' }, space: { S200: '8px', S400: '16px' } },
}));

vi.mock('../../../components/glass/GlassPrimitives', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { role: 'dialog' }, children),
  Header: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('header', null, children),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

const baseSnapshot = (): OfflineRoomSnapshot => ({
  status: 'ready',
  loaded: true,
  opened: true,
  storageAvailable: true,
  historyExhausted: true,
  historyComplete: true,
  hasGap: false,
  undecryptedEvents: 0,
  unresolvedRelations: 0,
  savedEvents: 0,
  bytes: 0,
  saved: 0,
  missing: 0,
  missingEssential: 0,
  pinned: false,
  downloading: false,
});

const createOfflineFixture = (initial: OfflineRoomSnapshot) => {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const controller: OfflineRoomController = {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((_roomId, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    download: vi.fn(),
    cancel: vi.fn(),
    setPinned: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  };
  const engine = { offline: controller } as MindroomSyncEngine;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <MindroomSyncEngineProvider engine={engine}>
        <OfflineRoomSettings roomId="!room:example.test" />
      </MindroomSyncEngineProvider>
    );
  });
  return {
    controller,
    renderer,
    publish: (next: OfflineRoomSnapshot) => {
      snapshot = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
};

const nodeText = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : nodeText(child))).join('');

const button = (renderer: ReactTestRenderer, label: string): ReactTestInstance =>
  renderer.root.findAllByType('button').find((candidate) => nodeText(candidate) === label)!;

const switchInput = (renderer: ReactTestRenderer, label: string): ReactTestInstance =>
  renderer.root
    .findAllByType('input')
    .find((candidate) => candidate.props['aria-label'] === label)!;

const renderedText = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('span')
    .flatMap((node) => node.children)
    .join(' ');

describe('OfflineRoomSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports partial history, unreadable content, and combined attachment coverage honestly', () => {
    const { renderer } = createOfflineFixture({
      ...baseSnapshot(),
      historyExhausted: false,
      historyComplete: false,
      hasGap: true,
      undecryptedEvents: 1,
      unresolvedRelations: 2,
      savedEvents: 37,
      bytes: 1_234_000,
      saved: 4,
      missing: 5,
      missingEssential: 2,
    });

    const text = renderedText(renderer);
    expect(text).toContain('Some earlier history has not been saved.');
    expect(text).toContain('Some history is currently inaccessible.');
    expect(text).toContain('Encrypted events waiting for keys: 1');
    expect(text).toContain('Unresolved edits or replies: 2');
    expect(text).toContain('Missing essential message bodies: 2');
    expect(text).toContain('Attachments: 4 saved, 5 missing.');
    expect(text).toContain('Saved history entries: 37');
    expect(text).toContain('Attachment storage used: 1.2 MB');
  });

  it('sends download, include-all, cancel, and pin intents to the room controller', async () => {
    const { controller, renderer, publish } = createOfflineFixture(baseSnapshot());

    act(() => switchInput(renderer, 'Include all media').props.onChange());
    act(() => button(renderer, 'Download entire room').props.onClick());
    expect(controller.download).toHaveBeenCalledWith('!room:example.test', {
      includeAllMedia: true,
    });

    publish({ ...baseSnapshot(), downloading: true, status: 'saving' });
    act(() => button(renderer, 'Cancel download').props.onClick());
    expect(controller.cancel).toHaveBeenCalledWith('!room:example.test');

    await act(async () => {
      switchInput(renderer, 'Keep offline').props.onChange();
    });
    expect(controller.setPinned).toHaveBeenCalledWith('!room:example.test', true);
  });

  it.each([
    ['space', true, 'Saving is paused because protected content fills the storage budget.'],
    ['read-only', true, 'Storage failed. Reopen the app to resume saving.'],
    ['offline', true, 'Saving is paused while the device is offline.'],
    ['limited', false, 'Automatic saving is paused on this connection.'],
  ] as const)(
    'describes the %s pause without promising complete storage',
    (status, downloading, message) => {
      const { renderer } = createOfflineFixture({ ...baseSnapshot(), status, downloading });

      expect(renderedText(renderer)).toContain(message);
    }
  );

  it('requires confirmation before clearing room content and supports cancellation', async () => {
    const { controller, renderer } = createOfflineFixture({
      ...baseSnapshot(),
      bytes: 42_000,
      saved: 2,
    });

    act(() => button(renderer, 'Clear downloaded content').props.onClick());
    expect(renderer.root.findByProps({ role: 'dialog' })).toBeDefined();
    expect(controller.clear).not.toHaveBeenCalled();

    act(() => button(renderer, 'Cancel').props.onClick());
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);

    act(() => button(renderer, 'Clear downloaded content').props.onClick());
    await act(async () => button(renderer, 'Clear content').props.onClick());
    expect(controller.clear).toHaveBeenCalledWith('!room:example.test');
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  });

  it('keeps the confirmation open and reports a rejected clear', async () => {
    const { controller, renderer } = createOfflineFixture(baseSnapshot());
    vi.mocked(controller.clear).mockRejectedValueOnce(new Error('failed'));

    act(() => button(renderer, 'Clear downloaded content').props.onClick());
    await act(async () => button(renderer, 'Clear content').props.onClick());

    expect(renderer.root.findByProps({ role: 'dialog' })).toBeDefined();
    expect(renderedText(renderer)).toContain('Downloaded content could not be cleared.');
  });

  it('reports pin failures without changing the controller snapshot', async () => {
    const { controller, renderer } = createOfflineFixture(baseSnapshot());
    vi.mocked(controller.setPinned).mockRejectedValueOnce(new Error('failed'));

    await act(async () => {
      switchInput(renderer, 'Keep offline').props.onChange();
    });

    expect(renderedText(renderer)).toContain('Keep offline could not be updated.');
    expect(switchInput(renderer, 'Keep offline').props.checked).toBe(false);
  });
});
