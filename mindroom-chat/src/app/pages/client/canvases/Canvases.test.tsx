// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../../state/sessions';
import { recordCanvas, type CanvasListEntry } from '../../../mindroom/canvas/canvasIndexStore';
import { saveCanvasState } from '../../../mindroom/canvas/canvasStateStore';
import { PINNED_CANVASES_TYPE } from '../../../mindroom/canvas/pinnedCanvases';
import { Canvases } from './Canvases';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWER = '@alice:example.org';
const HOMESERVER = 'https://example.org';
const SESSION = createSessionId(HOMESERVER, VIEWER);
const AGENT = '@mindroom_planner:example.org';

const mocks = vi.hoisted(() => ({
  pins: undefined as unknown,
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
  setAccountData: vi.fn(),
  load: vi.fn(),
  recordEvent: vi.fn(),
  requestOpen: vi.fn(),
  cancelOpen: vi.fn(),
  rooms: new Map<string, { membership: string; name: string }>(),
  pinEvents: new WeakMap<object, MatrixEvent>(),
}));

vi.mock('../../../hooks/useMatrixClient', () => {
  // One client for the whole test, like the app's.
  const client = {
    getSafeUserId: () => VIEWER,
    getHomeserverUrl: () => HOMESERVER,
    setAccountData: mocks.setAccountData,
    getAccountData: () => (mocks.pins ? { getContent: () => mocks.pins } : undefined),
    getRoom: (roomId: string) => {
      const room = mocks.rooms.get(roomId);
      return room
        ? {
            roomId,
            name: room.name,
            getMyMembership: () => room.membership,
            getMember: () => ({ rawDisplayName: 'Planner' }),
          }
        : null;
    },
  };
  return { useMatrixClient: () => client };
});
vi.mock('../../../hooks/useAccountData', () => ({
  // Like the real hook, the same account data event is returned until it changes.
  useAccountData: (type: string) => {
    const pins = mocks.pins as object | undefined;
    if (type !== PINNED_CANVASES_TYPE || !pins) return undefined;
    if (!mocks.pinEvents.has(pins)) {
      mocks.pinEvents.set(pins, { getContent: () => pins } as unknown as MatrixEvent);
    }
    return mocks.pinEvents.get(pins);
  },
}));
vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: mocks.navigateRoom,
    navigateRoomThread: mocks.navigateRoomThread,
  }),
}));
vi.mock('../../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));
vi.mock('../../../utils/room', () => ({
  getMemberDisplayName: () => 'Planner',
}));
vi.mock('../../../mindroom/canvas/canvasIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../mindroom/canvas/canvasIndex')>()),
  loadCanvasEvent: mocks.load,
  recordCanvasEvent: mocks.recordEvent,
}));
// The sidebar's thread names: the thread's summary, or its first message.
vi.mock('../../../mindroom/threads/recentThreadViewModel', () => ({
  useRecentThreadViewModel: (_room: unknown, threadId: string) => ({
    summaryText: `Summary of ${threadId}`,
  }),
}));
vi.mock('../../../mindroom/canvas/useCanvasOpenRequest', () => ({
  requestCanvasOpen: mocks.requestOpen,
  cancelCanvasOpen: mocks.cancelOpen,
}));
vi.mock('../../../components/page', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Page: Wrapper, PageHeader: Wrapper, PageScroll: Wrapper, PageContent: Wrapper };
});
vi.mock('./Canvases.css', () => ({
  Note: 'Note',
  Empty: 'Empty',
  TableScroll: 'TableScroll',
  Table: 'Table',
  Link: 'Link',
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

const entry = (overrides: Partial<CanvasListEntry>): CanvasListEntry => ({
  canvasId: '$canvas',
  roomId: '!room:example.org',
  threadId: '$thread',
  agentUserId: AGENT,
  title: 'Plans',
  revisionId: '$canvas',
  createdTs: Date.UTC(2026, 9, 1, 9),
  updatedTs: Date.UTC(2026, 9, 1, 9),
  shared: false,
  ...overrides,
});

let root: Root | undefined;
let container: HTMLDivElement;

const render = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Canvases />));
  // The list is read from IndexedDB.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
};

const titles = () =>
  [...container.querySelectorAll('tbody tr')].map(
    (row) => row.querySelectorAll('td')[1].querySelector('button')?.textContent
  );

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  mocks.pins = undefined;
  mocks.rooms = new Map([
    ['!room:example.org', { membership: 'join', name: 'Planning' }],
    ['!other:example.org', { membership: 'join', name: 'Trips' }],
    ['!left:example.org', { membership: 'leave', name: 'Old' }],
  ]);
  [
    mocks.navigateRoom,
    mocks.navigateRoomThread,
    mocks.load,
    mocks.recordEvent,
    mocks.requestOpen,
    mocks.cancelOpen,
  ].forEach((mock) => mock.mockReset());
  mocks.setAccountData.mockReset().mockResolvedValue({});
  mocks.load.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe('Canvases', () => {
  it('lists pinned canvases first, then the most recently updated, in joined rooms only', async () => {
    await recordCanvas(SESSION, entry({ canvasId: '$old', title: 'Old plan', updatedTs: 1 }));
    await recordCanvas(SESSION, entry({ canvasId: '$new', title: 'New plan', updatedTs: 3 }));
    await recordCanvas(
      SESSION,
      entry({ canvasId: '$pinned', title: 'Home', roomId: '!other:example.org', updatedTs: 2 })
    );
    await recordCanvas(
      SESSION,
      entry({ canvasId: '$gone', title: 'Gone', roomId: '!left:example.org', updatedTs: 4 })
    );
    mocks.pins = { canvases: [{ room_id: '!other:example.org', event_id: '$pinned' }] };
    await render();
    expect(titles()).toEqual(['Home', 'New plan', 'Old plan']);
    const pinned = container.querySelector('tbody tr button[aria-pressed]');
    expect(pinned?.getAttribute('aria-pressed')).toBe('true');
    expect(pinned?.getAttribute('aria-label')).toBe('Unpin Home');
  });

  it('shows the thread, room, agent, dates, sharing and saved values of a canvas', async () => {
    await recordCanvas(SESSION, entry({ shared: true }));
    await recordCanvas(SESSION, entry({ canvasId: '$main', title: 'Main', threadId: undefined }));
    await saveCanvasState(SESSION, '$canvas', { json: '{}' });
    await render();
    const cells = (title: string) =>
      [
        ...[...container.querySelectorAll('tbody tr')]
          .find((tr) => tr.textContent?.includes(title))!
          .querySelectorAll('td'),
      ].map((cell) => cell.textContent);
    expect(cells('Plans').slice(1)).toEqual([
      'PlansShared with agentHas your values',
      'Summary of $thread',
      'Planning',
      'Planner',
      expect.stringContaining('2026'),
      expect.stringContaining('2026'),
    ]);
    // A canvas shown in the room itself has no thread.
    expect(cells('Main')[2]).toBe('');
  });

  it('opens a canvas in its thread, or just its thread or room', async () => {
    await recordCanvas(SESSION, entry({}));
    await recordCanvas(SESSION, entry({ canvasId: '$main', title: 'Main', threadId: undefined }));
    await render();
    // Coming back to the page abandons an open it asked for earlier.
    expect(mocks.cancelOpen).toHaveBeenCalledTimes(1);
    const row = (title: string) =>
      [...container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(title))!;
    act(() =>
      (row('Plans').querySelectorAll('td')[1].querySelector('button') as HTMLElement).click()
    );
    expect(mocks.requestOpen).toHaveBeenCalledWith('!room:example.org', '$canvas');
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith('!room:example.org', '$thread');
    act(() =>
      (row('Plans').querySelectorAll('td')[2].querySelector('button') as HTMLElement).click()
    );
    expect(mocks.requestOpen).toHaveBeenCalledTimes(1);
    expect(mocks.cancelOpen).toHaveBeenCalledTimes(2);
    expect(mocks.navigateRoomThread).toHaveBeenCalledTimes(2);
    expect(mocks.navigateRoomThread).toHaveBeenLastCalledWith('!room:example.org', '$thread');
    act(() =>
      (row('Plans').querySelectorAll('td')[3].querySelector('button') as HTMLElement).click()
    );
    expect(mocks.cancelOpen).toHaveBeenCalledTimes(3);
    expect(mocks.navigateRoom).toHaveBeenCalledWith('!room:example.org');
    act(() =>
      (row('Main').querySelectorAll('td')[1].querySelector('button') as HTMLElement).click()
    );
    expect(mocks.requestOpen).toHaveBeenLastCalledWith('!room:example.org', '$main');
    expect(mocks.navigateRoom).toHaveBeenCalledTimes(2);
  });

  it('shows a pin change at once and writes it as room and event IDs, one after another', async () => {
    await recordCanvas(SESSION, entry({}));
    mocks.pins = { canvases: [{ room_id: '!other:example.org', event_id: '$elsewhere' }] };
    // The SDK settles a write once it has echoed back; these wait until the test echoes them.
    let echo: () => void = () => undefined;
    mocks.setAccountData.mockImplementation(
      (_type: string, content: unknown) =>
        new Promise<void>((resolve) => {
          echo = () => {
            mocks.pins = content;
            resolve();
          };
        })
    );
    await render();
    const pin = () => container.querySelector('tbody tr button[aria-pressed]') as HTMLElement;
    act(() => pin().click());
    expect(pin().getAttribute('aria-pressed')).toBe('true');
    // Unpinned again before the pin echoed back.
    act(() => pin().click());
    expect(pin().getAttribute('aria-pressed')).toBe('false');
    await act(async () => undefined);
    expect(mocks.setAccountData).toHaveBeenCalledTimes(1);
    expect(mocks.setAccountData).toHaveBeenLastCalledWith(PINNED_CANVASES_TYPE, {
      canvases: [
        { room_id: '!other:example.org', event_id: '$elsewhere' },
        { room_id: '!room:example.org', event_id: '$canvas' },
      ],
    });
    await act(async () => echo());
    expect(mocks.setAccountData).toHaveBeenCalledTimes(2);
    expect(mocks.setAccountData).toHaveBeenLastCalledWith(PINNED_CANVASES_TYPE, {
      canvases: [{ room_id: '!other:example.org', event_id: '$elsewhere' }],
    });
    expect(pin().getAttribute('aria-pressed')).toBe('false');
    await act(async () => echo());
    expect(pin().getAttribute('aria-pressed')).toBe('false');
  });

  it('fetches and lists a canvas pinned on another device, once', async () => {
    const fetched = { getId: () => '$elsewhere' } as MatrixEvent;
    mocks.load.mockResolvedValue(fetched);
    mocks.pins = {
      canvases: [
        { room_id: '!other:example.org', event_id: '$elsewhere' },
        { room_id: '!unknown:example.org', event_id: '$unjoined' },
      ],
    };
    await render();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load.mock.calls[0][2]).toBe('$elsewhere');
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.anything(), fetched);
    await act(async () => recordCanvas(SESSION, entry({ canvasId: '$other-change' })));
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
    });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('says so when there are no canvases yet', async () => {
    await render();
    expect(container.textContent).toContain('No canvases yet.');
    expect(container.querySelector('table')).toBeNull();
  });
});
