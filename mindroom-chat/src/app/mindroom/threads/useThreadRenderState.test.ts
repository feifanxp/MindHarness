import React from 'react';
import { EventEmitter } from 'events';
import {
  EventStatus,
  EventTimelineSet,
  MatrixEvent,
  Room,
  RoomEvent,
  Thread,
  ThreadEvent,
} from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadRenderState } from './useThreadRenderState';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const attachSerializedReplacement = (
  targetEvent: MatrixEvent,
  replacementEventId: string,
  ts: number
) => {
  targetEvent.event.unsigned = {
    'm.relations': {
      'm.replace': {
        content: {
          body: `* ${replacementEventId}`,
          'm.new_content': {
            body: replacementEventId,
            msgtype: 'm.text',
          },
          'm.relates_to': {
            event_id: targetEvent.getId(),
            rel_type: 'm.replace',
          },
          msgtype: 'm.text',
        },
        event_id: replacementEventId,
        origin_server_ts: ts,
        room_id: '!room:example.org',
        sender: '@alice:example.org',
        type: 'm.room.message',
      },
    },
  };
};

const makeAiRunEditEvent = (eventId: string, ts: number, targetEventId: string, status: string) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        'io.mindroom.ai_run': {
          version: 1,
          status,
        },
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

type HookSnapshot = ReturnType<typeof useThreadRenderState>;

type MockThread = Thread &
  EventEmitter & {
    events: MatrixEvent[];
  };

type HarnessProps = {
  room: Room;
  roomTimelineSet: EventTimelineSet;
  threadTimelineSet?: EventTimelineSet;
  threadId?: string;
  thread: Thread | null;
  threadInitialCacheHydrated: boolean;
  onRender: (snapshot: HookSnapshot) => void;
};

function Harness({ onRender, ...props }: HarnessProps) {
  const snapshot = useThreadRenderState(props);
  onRender(snapshot);
  return null;
}

const makeTimelineSet = (): EventTimelineSet =>
  ({
    relations: {
      aggregateChildEvent: vi.fn(),
      getChildEventsForEvent: vi.fn(() => undefined),
    },
  } as unknown as EventTimelineSet);

const makeRoom = (rootEvent?: MatrixEvent, txnMap?: Map<string, MatrixEvent>): Room =>
  Object.assign(new EventEmitter(), {
    findEventById: vi.fn((eventId: string) =>
      rootEvent?.getId() === eventId ? rootEvent : undefined
    ),
    getEventForTxnId: vi.fn((txnId: string) => txnMap?.get(txnId)),
  }) as unknown as Room;

const makeThread = (rootEvent: MatrixEvent, events: MatrixEvent[]): MockThread =>
  Object.assign(new EventEmitter(), {
    id: rootEvent.getId(),
    rootEvent,
    events,
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => ({ getNeighbouringTimeline: () => null }),
    }),
  }) as unknown as MockThread;

const renderHookHarness = (
  props: Omit<HarnessProps, 'onRender'>
): {
  getSnapshot: () => HookSnapshot;
  getRenderCount: () => number;
  update: (nextProps: Omit<HarnessProps, 'onRender'>) => void;
  renderer: ReactTestRenderer;
} => {
  let latestSnapshot: HookSnapshot | undefined;
  let renderCount = 0;
  const onRender = (snapshot: HookSnapshot) => {
    renderCount += 1;
    latestSnapshot = snapshot;
  };

  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(Harness, { ...props, onRender }));
  });

  return {
    getSnapshot: () => {
      if (!latestSnapshot) {
        throw new Error('Hook snapshot was not captured');
      }
      return latestSnapshot;
    },
    getRenderCount: () => renderCount,
    update: (nextProps) => {
      act(() => {
        renderer?.update(React.createElement(Harness, { ...nextProps, onRender }));
      });
    },
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useThreadRenderState', () => {
  it('renders a pending local root from the room without waiting for cache hydration', () => {
    const localRoot = makeMessageEvent('~!room:example.org:txn-local-root', 1);
    localRoot.setTxnId('txn-local-root');
    const room = makeRoom(localRoot);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '~!room:example.org:txn-local-root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('live');
    expect(getSnapshot().threadEvents).toEqual([localRoot]);
    expect(getSnapshot().threadEventIndexMapRef.current.get(localRoot.getId()!)).toBe(0);

    renderer.unmount();
  });

  it('renders cached fallback events before initial cache hydration finishes', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const replyEvent = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('loading');
    expect(getSnapshot().threadEvents).toEqual([]);

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [replyEvent]);
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('cached');
    expect(getSnapshot().threadEvents).toEqual([replyEvent]);
    expect(getSnapshot().threadEventIndexMapRef.current.get('$reply')).toBe(0);

    renderer.unmount();
  });

  it('keeps the richer fallback event when live thread hydration brings a stale duplicate', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const staleLiveReply = makeMessageEvent('$reply', 2);
    const correctedFallbackReply = makeMessageEvent('$reply', 2);
    correctedFallbackReply.makeReplaced(makeEditEvent('$edit-2', 3, '$reply'));
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [staleLiveReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [correctedFallbackReply]);
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('cached');
    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(getSnapshot().threadEvents[1]).toBe(correctedFallbackReply);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$edit-2');

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('live');
    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(getSnapshot().threadEvents[1]).toBe(correctedFallbackReply);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$edit-2');

    renderer.unmount();
  });

  it('prefers a cached fallback event when it carries a newer bundled replacement than the live duplicate', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const staleLiveReply = makeMessageEvent('$reply', 2);
    staleLiveReply.makeReplaced(makeEditEvent('$edit-8', 8, '$reply'));
    const refetchedFallbackReply = makeMessageEvent('$reply', 2);
    attachSerializedReplacement(refetchedFallbackReply, '$edit-13', 13);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [staleLiveReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [refetchedFallbackReply]);
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('cached');
    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(getSnapshot().threadEvents[1]).toBe(refetchedFallbackReply);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$edit-13');

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(getSnapshot().threadEvents[1]).toBe(refetchedFallbackReply);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$edit-13');

    renderer.unmount();
  });

  it('rehydrates serialized replacements from cached fallback events', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const cachedReply = new MatrixEvent({
      content: {
        body: 'Thinking...  ⋯',
        msgtype: 'm.text',
      },
      event_id: '$reply',
      origin_server_ts: 2,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.replace': {
            content: {
              body: '* Final answer',
              'm.new_content': {
                body: 'Final answer',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$reply',
                rel_type: 'm.replace',
              },
              msgtype: 'm.text',
            },
            event_id: '$edit-1',
            origin_server_ts: 3,
            room_id: '!room:example.org',
            sender: '@alice:example.org',
            type: 'm.room.message',
          },
        },
      },
    });
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [cachedReply]);
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('cached');
    expect(getSnapshot().threadEvents[0].getId()).toBe('$reply');
    expect(getSnapshot().threadEvents[0].replacingEvent()?.getId()).toBe('$edit-1');

    renderer.unmount();
  });

  it('deduplicates a confirmed thread event when cached and live copies disagree on transaction metadata', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const cachedReply = makeMessageEvent('$reply', 2);
    cachedReply.event.unsigned = { transaction_id: 'txn-4' };
    const liveReply = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [liveReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [cachedReply]);
    });

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);

    renderer.unmount();
  });

  it('deduplicates local echo against confirmed event from /relations when room resolves the confirmed id', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // Local echo: still has ~-prefix ID, txnId set
    const localEcho = makeMessageEvent('~local-txn-5', 2);
    localEcho.setTxnId('txn-5');

    // Simulate updatePendingEvent having updated the local echo's ID
    const localEchoAfterSent = makeMessageEvent('$reply', 2);
    localEchoAfterSent.setTxnId('txn-5');

    // Confirmed event from /relations API — no transaction_id
    const confirmedReply = makeMessageEvent('$reply', 2);

    const txnMap = new Map<string, MatrixEvent>([['txn-5', localEchoAfterSent]]);
    const room = makeRoom(rootEvent, txnMap);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [confirmedReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    // Supplemental events include the local echo (from timeline listener)
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [localEcho]);
    });

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    // Should deduplicate: local echo and confirmed reply are the same message
    expect(getSnapshot().threadEvents.map((e) => e.getId())).toEqual(['$root', '$reply']);

    renderer.unmount();
  });

  it('refreshes a mounted thread when a post-mount reply receives streaming and terminal replacements', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const replyEvent = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, []);

    const { getSnapshot, getRenderCount, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root']);
    const initialRenderCount = getRenderCount();

    act(() => {
      thread.events.push(replyEvent);
      thread.emit(ThreadEvent.NewReply, thread, replyEvent);
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(getRenderCount()).toBeGreaterThan(initialRenderCount);
    const afterReplyRenderCount = getRenderCount();

    const streamingEdit = makeAiRunEditEvent('$reply-edit-streaming', 3, '$reply', 'streaming');
    act(() => {
      replyEvent.makeReplaced(streamingEdit);
    });

    expect(getRenderCount()).toBeGreaterThan(afterReplyRenderCount);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$reply-edit-streaming');
    const afterStreamingRenderCount = getRenderCount();

    const completedEdit = makeAiRunEditEvent('$reply-edit-completed', 4, '$reply', 'completed');
    act(() => {
      replyEvent.makeReplaced(completedEdit);
    });

    expect(getRenderCount()).toBeGreaterThan(afterStreamingRenderCount);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$reply-edit-completed');
    expect(
      (
        getSnapshot().threadEvents[1].replacingEvent()?.getContent()['m.new_content'] as {
          ['io.mindroom.ai_run']?: { status?: string };
        }
      )?.['io.mindroom.ai_run']?.status
    ).toBe('completed');

    renderer.unmount();
  });

  it('adds a post-mount NewReply payload when the SDK has not inserted it into thread events yet', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const localEchoReply = makeMessageEvent('~local-reply', 2);
    localEchoReply.setTxnId('txn-local-reply');
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, []);

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root']);

    act(() => {
      thread.emit(ThreadEvent.NewReply, thread, localEchoReply);
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual([
      '$root',
      '~local-reply',
    ]);
    expect(getSnapshot().threadEventIndexMapRef.current.get('~local-reply')).toBe(1);

    renderer.unmount();
  });

  it('renders a local echo from the room before the SDK thread emits NewReply', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const localEchoReply = makeMessageEvent('~local-reply', 2);
    localEchoReply.status = EventStatus.SENDING;
    localEchoReply.getContent()['m.relates_to'] = {
      event_id: '$root',
      rel_type: 'm.thread',
    };
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, []);
    const unrelatedReply = makeMessageEvent('~unrelated-reply', 3);
    unrelatedReply.getContent()['m.relates_to'] = {
      event_id: '$other-root',
      rel_type: 'm.thread',
    };
    const edit = makeEditEvent('~edit', 4, '~local-reply');

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root']);
    expect((room as unknown as EventEmitter).listenerCount(RoomEvent.LocalEchoUpdated)).toBe(1);

    act(() => {
      room.emit(RoomEvent.LocalEchoUpdated, unrelatedReply, room);
      room.emit(RoomEvent.LocalEchoUpdated, edit, room);
      room.emit(RoomEvent.LocalEchoUpdated, localEchoReply, room);
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual([
      '$root',
      '~local-reply',
    ]);
    expect(thread.events).toEqual([]);

    act(() => {
      localEchoReply.status = EventStatus.CANCELLED;
      room.emit(
        RoomEvent.LocalEchoUpdated,
        localEchoReply,
        room,
        '~local-reply',
        EventStatus.SENDING
      );
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root']);

    act(() => {
      thread.emit(ThreadEvent.NewReply, thread, localEchoReply);
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root']);

    act(() => {
      renderer.unmount();
    });
    expect((room as unknown as EventEmitter).listenerCount(RoomEvent.LocalEchoUpdated)).toBe(0);
  });

  it('deduplicates local echo against confirmed event in setSupplementalThreadEvents via fallback resolver', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // Local echo with txnId
    const localEcho = makeMessageEvent('~local-txn-7', 2);
    localEcho.setTxnId('txn-7');

    // Confirmed event with unsigned.transaction_id (from cache/API)
    const confirmedReply = makeMessageEvent('$confirmed-7', 2);
    confirmedReply.event.unsigned = { transaction_id: 'txn-7' };

    // Room does NOT resolve txnId (simulates cold reload)
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    // First supplemental batch: the local echo
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [localEcho]);
    });

    // Second supplemental batch: the confirmed reply with txn metadata
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [confirmedReply]);
    });

    // Should deduplicate: only the confirmed event survives
    expect(getSnapshot().threadEvents.map((e) => e.getId())).toEqual(['$confirmed-7']);

    renderer.unmount();
  });

  it('composed resolver falls back to event-derived txnId map when room.getEventForTxnId returns undefined', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // Local echo
    const localEcho = makeMessageEvent('~local-txn-8', 2);
    localEcho.setTxnId('txn-8');

    // Confirmed event from /relations with unsigned.transaction_id
    const confirmedReply = makeMessageEvent('$confirmed-8', 2);
    confirmedReply.event.unsigned = { transaction_id: 'txn-8' };

    // Room does NOT know about txn-8 (cold reload scenario)
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [confirmedReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    // Supplemental: add local echo (from cached events)
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [localEcho]);
    });

    // Hydrate live thread
    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    // Should deduplicate via fallback resolver
    expect(getSnapshot().threadEvents.map((e) => e.getId())).toEqual(['$root', '$confirmed-8']);

    renderer.unmount();
  });

  it('resets supplemental thread state cleanly', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const replyEvent = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [replyEvent]);
    });
    expect(getSnapshot().threadEvents).toEqual([replyEvent]);

    act(() => {
      getSnapshot().resetThreadRenderState('$root');
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('loading');
    expect(getSnapshot().threadEvents).toEqual([]);
    expect(getSnapshot().threadEventIndexMapRef.current.size).toBe(0);

    renderer.unmount();
  });

  // CINNY-207 AC2 render-gap RG3 (2026-07-04): minimized repro of the
  // AC2 stale-cache-divergence render-gap. The docker RG2 run named
  // the mechanism: engine converges, sink executes end to end, and
  // mergeThreadRenderEvents produces output whose target has
  // replacingEvent() set — yet the docker AC2 spec still cannot see
  // `edit-target v2 converged` in the DOM. The seam is between the
  // sink's own `setSupplementalThreadEvents` call and the render-held
  // MatrixEvent instance the DOM message body reads.
  //
  // Scenario replays the AC2 timing:
  //   t0: cache hydrate lands `editTargetV1` (no replacingEvent) in
  //       fallback via setSupplementalThreadEvents.
  //   t1: reconciler onRepaired fires with `[editTargetV1Fresh,
  //       editEventC]` — a DIFFERENT MatrixEvent instance for the
  //       same event id, plus the m.replace event carrying v2.
  //
  // The invariant the fix must satisfy: after t1, the merged
  // `threadEvents` output must contain an instance for the target
  // whose `replacingEvent()` returns the m.replace event AND whose
  // `getContent()` reflects the v2 body via
  // `getLatestMessageContent(target, target.replacingEvent())`.
  //
  // Fails on tip when the sink's own merge picks up the fresh
  // incoming instance but the target instance the render layer
  // subsequently sees still has replacingEvent() undefined —
  // typically because the applier mutated an instance that lost the
  // merge dedup race (the exact "render-held" mismatch the RG1
  // hydrateApplier counters were designed to catch).
  it('AC2 render-gap: reconciler onRepaired batch mutates the render-held target instance in place (CINNY-207 AC2 render-gap)', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // t0: cache hydrate handed the render layer these instances.
    // Neither carries a replacement — the divergence happened while
    // the client was away, so the cache was stale.
    const cachedReplyEvent = makeMessageEvent('$reply', 2);
    const cachedEditTargetV1 = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [cachedReplyEvent, cachedEditTargetV1]);
    });

    // Sanity: after the cache hydrate the render sees v1 with no
    // replacement.
    const beforeRepair = getSnapshot().threadEvents.find((mEvt) => mEvt.getId() === '$edit-target');
    expect(beforeRepair).toBeDefined();
    expect(beforeRepair?.replacingEvent()).toBeNull();
    expect(beforeRepair?.getContent().body).toBe('edit-target v1');

    // t1: reconciler onRepaired fires with `allMapped`, containing a
    // FRESH instance for the same target id plus the m.replace event
    // carrying v2. This mirrors the reconciler.ts path where
    // `preferLive` returns fresh MatrixEvent instances for events
    // the SDK does not already know.
    const freshEditTargetV1 = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    const editEventC = makeEditEvent('$edit-c', 4, '$edit-target');
    // Sanity: the two instances share an id but are distinct objects
    // — this is exactly the "fresh clone from server" shape.
    expect(freshEditTargetV1).not.toBe(cachedEditTargetV1);

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [freshEditTargetV1, editEventC]);
    });

    // The render layer must now see the target with replacingEvent()
    // set to editEventC. Which instance object it is (cached or
    // fresh) does not matter for correctness — what matters is that
    // the ONE the render holds carries the replacement. The idiom
    // the fix implements is "repair must reach the render-held
    // instance".
    const afterRepair = getSnapshot().threadEvents.find((mEvt) => mEvt.getId() === '$edit-target');
    expect(afterRepair).toBeDefined();
    expect(afterRepair?.replacingEvent()).toBe(editEventC);
    // The bundled body reachable through the SDK's own resolver is
    // the ultimate render-side truth (getLatestMessageContent reads
    // this).
    expect(
      (afterRepair?.replacingEvent()?.getContent() as Record<string, unknown> | undefined)?.[
        'm.new_content'
      ]
    ).toMatchObject({ body: '$edit-c' });

    renderer.unmount();
  });

  // CINNY-207 AC2 render-gap RG3 (2026-07-04): the sibling scenario
  // that matches the docker AC2 in-vivo counter snapshot exactly.
  // The RG2 diagnostic showed `reconcilesThreadNull: 0` — the SDK
  // Thread was non-null at reconciler inject time, so
  // the reconciler added its batch to it. The SDK dedupes on
  // event id and KEEPS its earlier instance for the same id (the
  // fresh clone gets discarded). Result at render time:
  //
  //   - `thread.events` contains sdkTarget (no replacingEvent unless
  //     the SDK's own aggregation applied it during addEvents).
  //   - fallbackEvents contains the reconciler's fresh merged output
  //     which DID get makeReplaced'd by the sink's own hydrate call.
  //   - initialRenderMode = 'live', so buildThreadEvents pulls
  //     `thread.events` FIRST then fallbackEvents.
  //
  // The merge dedup preference logic (`pickPreferredThreadRenderEvent`)
  // must keep whichever instance carries the replacement. If it
  // keeps the SDK instance whose replacingEvent is undefined instead
  // of the fallback instance whose replacingEvent is set, the render
  // shows v1.
  // CINNY-207 AC2 render-gap RG3 (2026-07-04): reproduces the actual
  // failing docker AC2 scenario. RG2 counters proved
  // `renderTargetHadReplacement` flatlines at 5 while
  // `renderTargetLackedReplacement` grows to 410+ over a 30s window —
  // subsequent re-renders (triggered by SDK sync bursts, ThreadEvent
  // updates, etc.) receive a target instance without the repair.
  //
  // Mechanism this test exercises: after the sink lands the
  // fallback state's target-with-replacement, the SDK's
  // `thread.events` mutates (e.g. a subsequent sync burst produces a
  // fresh MatrixEvent instance for the same id with NO replacement
  // bundled), and a downstream refresh tick re-runs `buildThreadEvents`.
  // The merge must still produce output whose target carries the
  // repair — otherwise every subsequent render regresses to v1
  // despite the fallback state being correct.
  //
  // If this test fails on tip and passes on the RG4 fix, the fix
  // idiom is exactly "repair reaches the render-held instance"
  // enforced across every re-render, not just the one immediately
  // following the sink.
  it('AC2 render-gap: target-with-replacement is preserved through subsequent SDK thread mutations (CINNY-207 AC2 render-gap RG3)', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const cachedEditTargetV1 = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    const sdkTargetV1 = makeMessageEvent('$edit-target', 3, '@alice:example.org', 'edit-target v1');
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [sdkTargetV1]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [cachedEditTargetV1]);
    });
    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    const freshEditTargetV1 = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    const editEventC = makeEditEvent('$edit-c', 4, '$edit-target');

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [freshEditTargetV1, editEventC]);
    });

    // Sanity: after the sink lands the repair, the target carries
    // it.
    const afterRepair = getSnapshot().threadEvents.find((mEvt) => mEvt.getId() === '$edit-target');
    expect(afterRepair?.replacingEvent()).toBe(editEventC);

    // NEW: simulate a subsequent SDK sync burst that replaces the
    // thread's live instance for the same id with a fresh clone that
    // does NOT carry the replacement (matches
    // `EventTimelineSet.addEventToTimeline` behavior when the SDK
    // creates a fresh MatrixEvent from raw JSON on live-event
    // dispatch — the fresh clone has no `_replacingEvent`). Fire
    // ThreadEvent.Update so the render tick refresh kicks in, which
    // is what happens in production when the SDK's thread state
    // shifts (see useThreadEventRefresh subscribing to Update).
    const sdkTargetV1Refreshed = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    expect(sdkTargetV1Refreshed.replacingEvent()).toBeNull();
    act(() => {
      thread.events.length = 0;
      thread.events.push(sdkTargetV1Refreshed);
      thread.emit(ThreadEvent.Update, thread);
    });

    // The render layer MUST still see a target carrying editEventC.
    // If the merge picks the fresh SDK instance (no replacement) and
    // drops the fallback instance (with replacement), render
    // regresses to v1 — the exact docker AC2 failure mode.
    const afterSdkChurn = getSnapshot().threadEvents.find(
      (mEvt) => mEvt.getId() === '$edit-target'
    );
    expect(afterSdkChurn).toBeDefined();
    expect(afterSdkChurn?.replacingEvent()).toBe(editEventC);

    renderer.unmount();
  });

  it('AC2 render-gap: reconciler-repaired fallback instance wins over stale SDK thread duplicate (CINNY-207 AC2 render-gap)', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // t0 hydrate: the render holds cachedEditTargetV1 (no
    // replacement).
    const cachedEditTargetV1 = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    // The SDK Thread had its own instance for the target id — same
    // event, different MatrixEvent instance, also no replacement.
    // Populated by the SDK's own sync burst before reconciler runs.
    const sdkTargetV1 = makeMessageEvent('$edit-target', 3, '@alice:example.org', 'edit-target v1');
    expect(sdkTargetV1).not.toBe(cachedEditTargetV1);

    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [sdkTargetV1]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [cachedEditTargetV1]);
    });
    // Sync boundary: initialCacheHydrated flips true after
    // `hydrateThreadFromCache` returns; this mirrors what
    // threadOpenCacheFirst does in production.
    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    // t1: reconciler onRepaired fires with the fetched batch. The
    // fresh instance for the target and the m.replace event both
    // land in the sink; the sink's internal hydrate applies
    // makeReplaced on whatever instance won the sink's own merge
    // dedup.
    const freshEditTargetV1 = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    const editEventC = makeEditEvent('$edit-c', 4, '$edit-target');

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [freshEditTargetV1, editEventC]);
    });

    // Post-repair, the render layer must observe an instance for
    // $edit-target whose replacingEvent() returns editEventC. The
    // merge dedup between thread.events (sdkTargetV1, no
    // replacement) and fallbackEvents (fresh, WITH replacement after
    // sink hydrate) MUST prefer the one carrying the replacement.
    // This is the invariant "repair must reach the render-held
    // instance": no matter which instance the merge selects, the
    // one delivered to render must carry the repair.
    const afterRepair = getSnapshot().threadEvents.find((mEvt) => mEvt.getId() === '$edit-target');
    expect(afterRepair).toBeDefined();
    expect(afterRepair?.replacingEvent()).toBe(editEventC);
    expect(
      (afterRepair?.replacingEvent()?.getContent() as Record<string, unknown> | undefined)?.[
        'm.new_content'
      ]
    ).toMatchObject({ body: '$edit-c' });

    renderer.unmount();
  });

  // CINNY-207 AC2 render-gap RG5-fix2 (2026-07-04): required regression
  // test for team-lead's B-approval same-id merge preference addition.
  //
  // Two shapes, one rule (structural monotonic preference):
  //
  //  (i) COMMON PATH — same-sender edit. The existing pre-fix picker
  //      already handles this correctly (getEffectiveReplacementEvent
  //      yields the replacement for the repaired side and
  //      `preferredReplacement === existingReplacement && !==
  //      incomingReplacement` returns existingEvent). The fix must NOT
  //      regress this shape.
  //
  //  (ii) EDGE PATH — the effective-replacement helper drops the
  //       replacement (e.g. sender mismatch on the edit event vs the
  //       target sender — `isSameSenderEditEvent` filter drops it, or
  //       `_replacingEvent` was cleared post-apply by an SDK Relations
  //       recalc while no bundled fallback exists). Pre-fix picker
  //       falls through to `return incomingEvent` and silently wipes
  //       the repair. Post-fix, the raw `.replacingEvent()` presence
  //       check runs BEFORE the effective dance and pins the repaired
  //       instance.
  //
  // Both shapes model the exact production sequence:
  //   1. Sink call #1 with hydrated view (target + m.replace), the
  //      internal hydrate mutates target via makeReplaced. This is the
  //      onRepaired(mergedForHydrate) path from RG5-fix (commit
  //      52af9eed) — the reconciler-repaired view flowing through the
  //      sink.
  //   2. Sink call #2 with a fresh same-id instance, no replacement.
  //      This is `handleThreadNewReply → setSupplementalThreadEvents(
  //      threadId, [syncInstance])` — the NewReply late-arrival.
  //   3. Registry MUST still return an instance whose .replacingEvent()
  //      is set — no matter which of hydrated or fresh instance the
  //      picker chose, the survivor must carry the repair.
  it('AC2 render-gap RG5-fix2: post-repair NewReply with same-sender edit is preserved (CINNY-207 AC2 render-gap RG5-fix2)', () => {
    // Shape (i) — common path. Both pre- and post-fix pickers must
    // return the repaired instance for this shape (regression guard).
    const rootEvent = makeMessageEvent('$root', 1);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, []);

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    const hydratedTarget = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    const editEventC = makeEditEvent('$edit-c', 4, '$edit-target');

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [hydratedTarget, editEventC]);
    });
    expect(hydratedTarget.replacingEvent()).toBe(editEventC);

    const syncArrivalTarget = makeMessageEvent(
      '$edit-target',
      3,
      '@alice:example.org',
      'edit-target v1'
    );
    expect(syncArrivalTarget.replacingEvent()).toBeNull();
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [syncArrivalTarget]);
    });

    const afterNewReply = getSnapshot().threadEvents.find(
      (mEvt) => mEvt.getId() === '$edit-target'
    );
    expect(afterNewReply).toBeDefined();
    expect(afterNewReply?.replacingEvent()).toBe(editEventC);

    renderer.unmount();
  });

  it('AC2 render-gap RG5-fix2: post-repair NewReply preserves repair even when effective-replacement helper drops the edit (CINNY-207 AC2 render-gap RG5-fix2)', () => {
    // Shape (ii) — edge path. The repaired instance has
    // `.replacingEvent()` non-null but the edit event's sender differs
    // from the target sender, so `getEffectiveReplacementEvent`'s
    // `isSameSenderEditEvent` filter drops it. Pre-fix picker falls
    // through to `return incomingEvent` and wipes the repair.
    // Post-fix, the raw-replacement presence check pins the repaired
    // instance regardless of the effective helper's decision.
    //
    // This scenario also stands in for the RG4d-adjacent shape where
    // `_replacingEvent` remains set on the fallback instance but the
    // effective helper independently returns undefined (e.g. an SDK
    // Relations recalc raced the query, or a bundled fallback is
    // absent and the raw replacement's shape is one the helper would
    // reject) — the picker must not silently choose the non-repaired
    // sibling in any of those subtly-different circumstances.
    const rootEvent = makeMessageEvent('$root', 1);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, []);

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    const targetSender = '@alice:example.org';
    // Attach a foreign-sender edit event directly via makeReplaced;
    // sink hydrate would normally apply a same-sender edit, but the
    // helper's filter drops any replacement whose sender differs.
    // Pre-fix, this shape lets the non-repaired incoming sibling win
    // — that is exactly the door the fix closes.
    const hydratedTarget = makeMessageEvent('$edit-target', 3, targetSender, 'edit-target v1');
    const foreignSenderEdit = makeEditEvent('$edit-foreign', 4, '$edit-target', '@bob:example.org');
    // Bypass the sink's own hydrate (which wouldn't set a foreign-
    // sender replacement in the first place) by populating the
    // replacement directly. This isolates the picker's fall-through
    // behavior from the applier's sender rules.
    hydratedTarget.makeReplaced(foreignSenderEdit);
    expect(hydratedTarget.replacingEvent()).toBe(foreignSenderEdit);

    act(() => {
      // Feed the hydrated target into the sink without the edit event
      // in the batch — the sink's hydrate scan finds no replace
      // relation to apply, so the raw `.replacingEvent()` we just set
      // is what carries into the fallback registry.
      getSnapshot().setSupplementalThreadEvents('$root', [hydratedTarget]);
    });
    expect(hydratedTarget.replacingEvent()).toBe(foreignSenderEdit);

    const syncArrivalTarget = makeMessageEvent('$edit-target', 3, targetSender, 'edit-target v1');
    expect(syncArrivalTarget.replacingEvent()).toBeNull();
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [syncArrivalTarget]);
    });

    // Post-fix invariant: the survivor instance carries the raw
    // replacement (the foreign-sender edit event we attached).
    // Pre-fix (before the raw-replacement presence check), the picker
    // would return incomingEvent (syncArrivalTarget) and this
    // assertion would fail.
    const afterNewReply = getSnapshot().threadEvents.find(
      (mEvt) => mEvt.getId() === '$edit-target'
    );
    expect(afterNewReply).toBeDefined();
    expect(afterNewReply?.replacingEvent()).toBe(foreignSenderEdit);

    renderer.unmount();
  });
});
