import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { createClient, Room } from 'matrix-js-sdk';
import { useStateEvents } from './useStateEvents';
import {
  getPendingThreadTagsContent,
  resetPendingThreadTagsForTests,
  setPendingThreadTagsContent,
} from './threadTagPending';
import { buildPerTagStateKey, MINDROOM_THREAD_TAGS_EVENT } from './threadTags';
import { useRoomThreadResolutionMap, useThreadResolution } from './useRoomThreadTags';

vi.mock('./useStateEvents', () => ({
  useStateEvents: vi.fn(),
}));

const mockedUseStateEvents = vi.mocked(useStateEvents);
const makeRoom = () =>
  new Room(
    '!room:example.org',
    createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' }),
    '@alice:example.org'
  );

const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';
const ISO_3 = '2026-04-07T00:00:03.000Z';

afterEach(() => {
  vi.clearAllMocks();
  resetPendingThreadTagsForTests();
});

const makeLegacyThreadTagsEvent = (
  stateKey: string,
  tags: Record<string, Record<string, unknown>>
) =>
  new MatrixEvent({
    content: {
      tags,
    },
    event_id: `$thread-tags-${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makePerTagEvent = (threadRootId: string, tagName: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    content,
    event_id: `$thread-tag-${threadRootId}-${tagName}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: buildPerTagStateKey(threadRootId, tagName),
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makePerTagTombstoneEvent = (threadRootId: string, tagName: string) =>
  makePerTagEvent(threadRootId, tagName, {});

type ResolutionHarnessProps = {
  room: Room;
  threadRootId: string | undefined;
  onRender: (value: ReturnType<typeof useThreadResolution>) => void;
};

function ResolutionHarness({ room, threadRootId, onRender }: ResolutionHarnessProps) {
  onRender(useThreadResolution(room, threadRootId));
  return null;
}

type MapHarnessProps = {
  room: Room;
  onRender: (value: ReturnType<typeof useRoomThreadResolutionMap>) => void;
};

function MapHarness({ room, onRender }: MapHarnessProps) {
  onRender(useRoomThreadResolutionMap(room));
  return null;
}

describe('useRoomThreadTags compatibility with threadTags parser', () => {
  it('suspends resolution while pinned and restores it when the pin is removed', () => {
    const room = makeRoom();
    const syncPins = (pinned: string[]) =>
      room.currentState.setStateEvents([
        new MatrixEvent({
          type: 'm.room.pinned_events',
          state_key: '',
          room_id: room.roomId,
          content: { pinned },
        }),
      ]);
    syncPins(['$root']);
    const tag = makePerTagEvent('$root', 'resolved', {
      set_by: '@alice:example.org',
      set_at: ISO_1,
    });
    mockedUseStateEvents.mockImplementation((_room, type) =>
      type === MINDROOM_THREAD_TAGS_EVENT ? [tag] : []
    );
    let snapshot!: ReturnType<typeof useThreadResolution>;
    const render = () =>
      React.createElement(ResolutionHarness, {
        room,
        threadRootId: '$root',
        onRender: (value) => {
          snapshot = value;
        },
      });
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(render());
    });
    expect(snapshot.isResolved).toBe(false);
    act(() => syncPins([]));
    expect(snapshot.isResolved).toBe(true);
    renderer.unmount();
  });
  it('reads resolved state and plain tag names from per-tag state events', () => {
    const room = makeRoom();
    mockedUseStateEvents.mockImplementation((_room, eventType) => {
      if (eventType === MINDROOM_THREAD_TAGS_EVENT) {
        return [
          makePerTagEvent('$root', 'resolved', {
            set_by: '@alice:example.org',
            set_at: ISO_1,
          }),
          makePerTagEvent('$root', 'urgent', {
            set_by: '@alice:example.org',
            set_at: ISO_2,
          }),
        ];
      }
      return [];
    });

    let snapshot: ReturnType<typeof useThreadResolution> | undefined;
    const renderer = create(
      React.createElement(ResolutionHarness, {
        room,
        threadRootId: '$root',
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot?.isResolved).toBe(true);
    expect(snapshot?.tags).toEqual({
      resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
      urgent: { set_by: '@alice:example.org', set_at: ISO_2 },
    });

    renderer.unmount();
  });

  it('builds a room resolution map from mixed legacy and per-tag state', () => {
    const room = makeRoom();
    mockedUseStateEvents.mockImplementation((_room, eventType) => {
      if (eventType === MINDROOM_THREAD_TAGS_EVENT) {
        return [
          makeLegacyThreadTagsEvent('$root', {
            resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
            urgent: { set_by: '@alice:example.org', set_at: ISO_2 },
          }),
          makePerTagEvent('$root', 'urgent', {
            set_by: '@bob:example.org',
            set_at: ISO_3,
          }),
          makePerTagTombstoneEvent('$root', 'resolved'),
          makePerTagEvent('$other', 'blocked', {
            set_by: '@carol:example.org',
            set_at: ISO_2,
          }),
        ];
      }
      return [];
    });

    let snapshot: ReturnType<typeof useRoomThreadResolutionMap> | undefined;
    const renderer = create(
      React.createElement(MapHarness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot?.get('$root')).toMatchObject({
      isResolved: false,
      tags: {
        urgent: { set_by: '@bob:example.org', set_at: ISO_3 },
      },
    });
    expect(snapshot?.get('$other')).toMatchObject({
      isResolved: false,
      tags: {
        blocked: { set_by: '@carol:example.org', set_at: ISO_2 },
      },
    });

    renderer.unmount();
  });

  it('applies pending custom tags before state sync arrives', () => {
    const room = makeRoom();
    setPendingThreadTagsContent(room.roomId, '$root', {
      tags: {
        resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
        urgent: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });

    let snapshot: ReturnType<typeof useThreadResolution> | undefined;
    const renderer = create(
      React.createElement(ResolutionHarness, {
        room,
        threadRootId: '$root',
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot).toMatchObject({
      isResolved: true,
      isPending: true,
      tags: {
        resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
        urgent: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });

    renderer.unmount();
  });

  it('clears pending content once aggregated live state matches it', () => {
    const room = makeRoom();
    setPendingThreadTagsContent(room.roomId, '$root', {
      tags: {
        urgent: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });
    mockedUseStateEvents.mockImplementation((_room, eventType) => {
      if (eventType === MINDROOM_THREAD_TAGS_EVENT) {
        return [
          makePerTagEvent('$root', 'urgent', {
            set_by: '@alice:example.org',
            set_at: ISO_2,
          }),
        ];
      }
      return [];
    });

    let snapshot: ReturnType<typeof useRoomThreadResolutionMap> | undefined;
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        React.createElement(MapHarness, {
          room,
          onRender: (value) => {
            snapshot = value;
          },
        })
      );
    });

    expect(snapshot?.get('$root')).toMatchObject({
      tags: {
        urgent: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });
    expect(getPendingThreadTagsContent(room.roomId, '$root')).toBeUndefined();

    renderer?.unmount();
  });
});
