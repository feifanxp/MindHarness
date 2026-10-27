import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'slate';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { UserMentionAutocomplete } from './UserMentionAutocomplete';
import { SEARCH_NOW_SCAN_LIMIT } from '../../../hooks/useAsyncSearch';

const member = (userId: string, name: string) =>
  ({
    userId,
    name,
    rawDisplayName: name,
    membership: 'join',
    getMxcAvatarUrl: () => undefined,
  } as unknown as RoomMember);
const maya = member('@maya:x', 'Maya');
const grace = member('@grace:x', 'Grace');
const mind = member('@mind:x', 'Mind');
let members: RoomMember[] = [];

const replaceWithElement = vi.hoisted(() => vi.fn());
vi.mock('../utils', () => ({
  createMentionElement: (id: string) => ({ id }),
  replaceWithElement,
  moveCursor: () => undefined,
}));
vi.mock('../../../hooks/useRoomMembers', () => ({ useRoomMembers: () => members }));
vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:x' }),
}));
vi.mock('../../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('./AutocompleteMenu', () => ({
  AutocompleteMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../glass/GlassPrimitives', () => ({
  MenuItem: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock('../../user-avatar', () => ({ UserAvatar: () => null }));

const keydownListeners = new Set<(evt: KeyboardEvent) => void>();
const originalWindow = globalThis.window;

beforeEach(() => {
  vi.useFakeTimers();
  let now = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      // Each match takes 10 ms, so the search yields after one member and has not answered yet.
      performance: {
        now: () => {
          now += 10;
          return now;
        },
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: (_type: string, handler: (evt: KeyboardEvent) => void) =>
        keydownListeners.add(handler),
      removeEventListener: (_type: string, handler: (evt: KeyboardEvent) => void) =>
        keydownListeners.delete(handler),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  keydownListeners.clear();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

const room = { roomId: '!r:x', getCanonicalAlias: () => null, getMember: () => null };
const picker = () => (
  <UserMentionAutocomplete
    room={room as unknown as Room}
    editor={{} as Editor}
    query={{ range: {} as never, prefix: '@', text: 'Min' }}
    requestClose={() => undefined}
  />
);

const pressTab = () => {
  replaceWithElement.mockClear();
  const tab = { key: 'Tab', preventDefault: () => undefined } as KeyboardEvent;
  act(() => keydownListeners.forEach((handler) => handler(tab)));
};

// Answers the search for `Min` in full, then hands the picker a new member list, as useRoomMembers does.
const renderThenChangeMembers = (nextMembers: RoomMember[]) => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(picker());
  });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  members = nextMembers;
  act(() => renderer.update(picker()));
};

describe('UserMentionAutocomplete', () => {
  it('takes a member matching the typed text on Tab before the search answers', () => {
    members = [maya, grace, mind];
    act(() => {
      create(picker());
    });

    pressTab();

    expect(replaceWithElement).toHaveBeenCalledWith({}, {}, { id: '@mind:x' });
  });

  it('takes a matching member on Tab after the member list changes', () => {
    members = [maya, grace, mind];
    renderThenChangeMembers([...members]);

    pressTab();

    expect(replaceWithElement).toHaveBeenCalledWith({}, {}, { id: '@mind:x' });
  });

  it('takes the named member on Tab once the list grows to include them', () => {
    members = [maya, grace];
    renderThenChangeMembers([maya, grace, mind]);

    pressTab();

    expect(replaceWithElement).toHaveBeenCalledWith({}, {}, { id: '@mind:x' });
  });

  it('inserts nothing on Tab until the search reaches a match past the immediate scan', () => {
    const others = Array.from({ length: SEARCH_NOW_SCAN_LIMIT }, (_, i) =>
      member(`@u${i}:x`, `User ${i}`)
    );
    members = [...others, mind];
    act(() => {
      create(picker());
    });

    pressTab();
    expect(replaceWithElement).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });
    pressTab();
    expect(replaceWithElement).toHaveBeenCalledWith({}, {}, { id: '@mind:x' });
  });
});
