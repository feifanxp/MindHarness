import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { config, toRem } from 'folds';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import {
  userDirectoryCacheAtom,
  type UserDirectoryCacheState,
} from '../../state/userDirectoryCache';
import { InviteUserPrompt } from './InviteUserPrompt';

const directUsersMock = vi.hoisted(() => ({
  users: [] as string[],
}));

type WindowKeyHandler = (event: KeyboardEvent) => void;
const windowListeners = new Map<string, Set<WindowKeyHandler>>();

vi.mock('../page', () => ({
  PageScroll: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, header, children),
}));
vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    Overlay: ({ children, backdrop }: { children?: React.ReactNode; backdrop?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, backdrop, children),
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    PopOut: ({
      anchor,
      content,
      children,
    }: {
      anchor?: unknown;
      content?: React.ReactNode;
      children?: React.ReactNode;
    }) => React.createElement('div', { 'data-popout': true }, children, anchor ? content : null),
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('./InviteAutocompleteMenu.css', () => ({
  InviteAutocompleteMenuRoot: 'InviteAutocompleteMenuRoot',
  InviteAutocompletePopOut: 'InviteAutocompletePopOut',
  InviteAutocompleteMenuContainer: 'InviteAutocompleteMenuContainer',
  InviteAutocompleteMenu: 'InviteAutocompleteMenu',
  InviteAutocompleteMenuHeader: 'InviteAutocompleteMenuHeader',
  InviteAutocompleteOption: 'InviteAutocompleteOption',
  InviteAutocompleteIdentity: 'InviteAutocompleteIdentity',
  InviteAutocompleteDisplayName: 'InviteAutocompleteDisplayName',
  InviteAutocompleteUserId: 'InviteAutocompleteUserId',
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useDirectUsers', () => ({
  useDirectUsers: () => directUsersMock.users,
}));

vi.mock('../user-avatar', () => ({
  UserAvatar: ({ userId, src, alt }: { userId: string; src?: string; alt?: string }) =>
    React.createElement('span', { 'data-user-id': userId, 'data-src': src, 'data-alt': alt }),
}));

vi.mock('../../styles/Text.css', () => ({
  BreakWord: 'BreakWord',
}));

type MockMatrixClient = Pick<
  MatrixClient,
  | 'baseUrl'
  | 'getSafeUserId'
  | 'getHomeserverUrl'
  | 'mxcUrlToHttp'
  | 'searchUserDirectory'
  | 'invite'
>;

const readyCache = (): UserDirectoryCacheState => ({
  users: [
    {
      userId: '@suggestion:example.org',
      displayName: '@alice:example.org',
    },
  ],
  status: 'ready',
  fetchedAt: Date.now(),
  limited: false,
  isBootstrapOnly: false,
  ownerKey: '@me:example.org|https://example.org',
});

const makeMx = (): MockMatrixClient => ({
  baseUrl: 'https://example.org',
  getSafeUserId: vi.fn(() => '@me:example.org'),
  getHomeserverUrl: vi.fn(() => 'https://example.org'),
  mxcUrlToHttp: vi.fn((mxcUrl: string) => `https://example.org/media/${mxcUrl}`),
  searchUserDirectory: vi.fn(async () => ({
    limited: false,
    results: [],
  })),
  invite: vi.fn(async () => undefined),
});

const makeRoom = (): Pick<Room, 'roomId' | 'getMember'> => ({
  roomId: '!room:example.org',
  getMember: () => null,
});

const anchorRect = {
  x: 24,
  y: 100,
  width: 320,
  height: 40,
  top: 100,
  bottom: 140,
  left: 24,
  right: 344,
};

const createNodeMock = (element: React.ReactElement) => {
  const className = typeof element.props.className === 'string' ? element.props.className : '';
  if (className.includes('InviteAutocompleteMenuRoot')) {
    return { getBoundingClientRect: () => anchorRect };
  }
  return null;
};

const renderPrompt = () => {
  const store = createStore();
  const mx = makeMx();
  const room = makeRoom();
  store.set(userDirectoryCacheAtom, readyCache());

  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <MatrixClientProvider value={mx as MatrixClient}>
          <InviteUserPrompt room={room as Room} requestClose={vi.fn()} />
        </MatrixClientProvider>
      </Provider>,
      { createNodeMock }
    );
  });

  return {
    renderer: renderer!,
    mx,
    room,
  };
};

const getInput = (renderer: ReactTestRenderer) => renderer.root.findByProps({ role: 'combobox' });

const getForm = (renderer: ReactTestRenderer) => renderer.root.find((node) => node.type === 'form');

const getDialog = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) =>
      node.type === 'div' &&
      node.props.style?.width === '100%' &&
      typeof node.props.style?.maxWidth === 'string'
  );

const getOptions = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props.role === 'option');

const typeUserId = (renderer: ReactTestRenderer, value: string) => {
  act(() => {
    getInput(renderer).props.onFocus();
    getInput(renderer).props.onChange({
      currentTarget: { value },
    });
  });
};

const keyDown = (renderer: ReactTestRenderer, key: string) => {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const keyboardEvent = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault,
    stopPropagation,
  } as KeyboardEvent;

  act(() => {
    getInput(renderer).props.onKeyDown(keyboardEvent);
    windowListeners.get('keydown')?.forEach((handler) => handler(keyboardEvent));
  });

  return { preventDefault, stopPropagation };
};

const submitInvite = async (renderer: ReactTestRenderer) => {
  const preventDefault = vi.fn();

  await act(async () => {
    getForm(renderer).props.onSubmit({
      preventDefault,
      target: {
        reasonInput: {
          value: '',
        },
      },
    });
    await Promise.resolve();
  });

  return preventDefault;
};

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

beforeEach(() => {
  windowListeners.clear();
  directUsersMock.users = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: { clientHeight: 768 },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      performance: {
        now: vi.fn(() => 0),
      },
      location: { protocol: 'https:' },
      addEventListener: vi.fn((type: string, handler: WindowKeyHandler) => {
        const handlers = windowListeners.get(type) ?? new Set<WindowKeyHandler>();
        handlers.add(handler);
        windowListeners.set(type, handlers);
      }),
      removeEventListener: vi.fn((type: string, handler: WindowKeyHandler) => {
        windowListeners.get(type)?.delete(handler);
      }),
    },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: originalDocument,
  });
});

describe('InviteUserPrompt', () => {
  it('uses a wider responsive dialog so invite matches have room to breathe', () => {
    const { renderer } = renderPrompt();

    expect(getDialog(renderer).props.style).toMatchObject({
      width: '100%',
      maxWidth: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(680)})`,
    });
  });

  it.each([
    { key: 'Enter', closesSuggestions: false },
    { key: 'Tab', closesSuggestions: true },
  ])(
    'submits a typed valid MXID after $key even when suggestions are open',
    async ({ key, closesSuggestions }) => {
      const { renderer, mx, room } = renderPrompt();

      typeUserId(renderer, '@alice:example.org');
      expect(getOptions(renderer)).toHaveLength(1);

      const { preventDefault: keyPreventDefault } = keyDown(renderer, key);

      expect(keyPreventDefault).not.toHaveBeenCalled();
      expect(getOptions(renderer)).toHaveLength(closesSuggestions ? 0 : 1);

      const submitPreventDefault = await submitInvite(renderer);

      expect(submitPreventDefault).toHaveBeenCalled();
      expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@alice:example.org', undefined);
      expect(mx.invite).not.toHaveBeenCalledWith(room.roomId, '@suggestion:example.org', undefined);
    }
  );
});
