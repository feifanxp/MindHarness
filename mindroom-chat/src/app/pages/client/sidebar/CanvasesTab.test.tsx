// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../../state/sessions';
import { recordCanvas } from '../../../mindroom/canvas/canvasIndexStore';
import { CanvasesTab } from './CanvasesTab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWER = '@alice:example.org';
const HOMESERVER = 'https://example.org';

const state = vi.hoisted(() => ({
  pins: undefined as unknown,
  mx: {
    getSafeUserId: () => '@alice:example.org',
    getHomeserverUrl: () => 'https://example.org',
  },
}));

vi.mock('../../../hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../../hooks/useAccountData', () => ({
  useAccountData: () =>
    state.pins ? ({ getContent: () => state.pins } as unknown as MatrixEvent) : undefined,
}));
vi.mock('../../../components/sidebar', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarItemTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) => (
    <>{children(() => undefined)}</>
  ),
  SidebarAvatar: ({ as, ...props }: { as?: string } & Record<string, unknown>) =>
    React.createElement(as ?? 'div', props),
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

let root: Root | undefined;
let container: HTMLDivElement;

const render = async (path = '/home/') => {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <CanvasesTab />
      </MemoryRouter>
    )
  );
  await settle();
};

// Longer than the 100 ms the tab waits after list changes.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
  });

const tab = () => container.querySelector('button[aria-label="Canvases"]');

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  state.pins = undefined;
});

afterEach(() => {
  act(() => root?.unmount());
});

describe('CanvasesTab', () => {
  it('stays hidden until a canvas is listed, then shows', async () => {
    await render();
    expect(tab()).toBeNull();
    await act(async () =>
      recordCanvas(createSessionId(HOMESERVER, VIEWER), {
        canvasId: '$canvas',
        roomId: '!room:example.org',
        agentUserId: '@mindroom_planner:example.org',
        title: 'Plans',
        revisionId: '$canvas',
        createdTs: 1,
        updatedTs: 1,
        shared: false,
      })
    );
    await settle();
    expect(tab()).not.toBeNull();
  });

  it('starts from the last answer when the sidebar mounts again', async () => {
    await act(async () =>
      recordCanvas(createSessionId(HOMESERVER, VIEWER), {
        canvasId: '$canvas',
        roomId: '!room:example.org',
        agentUserId: '@mindroom_planner:example.org',
        title: 'Plans',
        revisionId: '$canvas',
        createdTs: 1,
        updatedTs: 1,
        shared: false,
      })
    );
    await render();
    expect(tab()).not.toBeNull();
    act(() => root?.unmount());
    // No wait for IndexedDB: phones rebuild the sidebar on every navigation screen.
    container = document.createElement('div');
    root = createRoot(container);
    act(() =>
      root!.render(
        <MemoryRouter initialEntries={['/home/']}>
          <CanvasesTab />
        </MemoryRouter>
      )
    );
    expect(tab()).not.toBeNull();
  });

  it('shows for a pinned canvas this browser has not listed', async () => {
    state.pins = { canvases: [{ room_id: '!room:example.org', event_id: '$elsewhere' }] };
    await render();
    expect(tab()).not.toBeNull();
  });

  it('stays while its page is open', async () => {
    await render('/canvases/');
    expect(tab()).not.toBeNull();
  });
});
