import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { FeatureSupport, Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { expect, it, vi } from 'vitest';
import { useThreadRenderState } from './useThreadRenderState';

it.each(['already loaded', 'arriving'] as const)(
  'renders %s SDK replies while cache, bootstrap, and thread metadata remain pending',
  async (mode) => {
    const support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    // Server discovery never finishes, so SDK thread metadata stays pending.
    mx.threadSupportPending = new Promise(() => {});
    const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
    const root = new MatrixEvent({
      event_id: '$root',
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { body: 'Root', msgtype: 'm.text' },
    });
    const reply = new MatrixEvent({
      ...root.event,
      event_id: '$reply',
      origin_server_ts: 2,
      content: {
        body: 'Available reply',
        msgtype: 'm.text',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });
    const thread = room.createThread('$root', root, [], false);
    thread.initialEventsFetched = true;
    thread.replayEvents = null;
    const metadataUpdate = vi.fn();
    thread.on(ThreadEvent.Update, metadataUpdate);
    const timelineSet = thread.getUnfilteredTimelineSet();
    const addReply = () => {
      thread.setEventMetadata(reply);
      timelineSet.addEventsToTimeline([reply], true, false, timelineSet.getLiveTimeline(), null);
    };
    if (mode === 'already loaded') addReply();
    const listenerCount = thread.listenerCount(RoomEvent.Timeline);
    const resetListenerCount = thread.listenerCount(RoomEvent.TimelineReset);
    let state!: ReturnType<typeof useThreadRenderState>;
    const Harness = () => {
      state = useThreadRenderState({
        room,
        roomTimelineSet: room.getUnfilteredTimelineSet(),
        threadTimelineSet: timelineSet,
        threadId: '$root',
        thread,
        threadInitialCacheHydrated: false,
        threadInitialSdkLoaded: false,
      });
      return (
        <>
          {state.threadEvents.map((event) => (
            <span key={event.getId()}>{event.getContent().body}</span>
          ))}
        </>
      );
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<Harness />);
      });
      if (mode === 'arriving') {
        act(() => state.setSupplementalThreadEvents('$root', [root]));
        expect(state.threadEvents).toEqual([root]);
        const detachedReply = new MatrixEvent({
          ...reply.event,
          event_id: '$disconnected',
          content: { ...reply.getContent(), body: 'Disconnected reply' },
        });
        thread.setEventMetadata(detachedReply);
        await act(async () => {
          timelineSet.addEventsToTimeline(
            [detachedReply],
            true,
            false,
            timelineSet.addTimeline(),
            null
          );
        });
        expect(state.threadEvents).toEqual([root]);
        expect(state.threadInitialRenderMode).toBe('cached');
        await act(async () => addReply());
      }
      expect(metadataUpdate).not.toHaveBeenCalled();
      expect(thread.events).toContain(reply);
      expect(state.threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
      expect(state.threadInitialRenderMode).toBe('cached');
      expect(renderer!.root.findAllByType('span').map((node) => node.children.join(''))).toEqual([
        'Root',
        'Available reply',
      ]);
      act(() =>
        reply.makeReplaced(
          new MatrixEvent({
            ...reply.event,
            event_id: '$edit',
            origin_server_ts: 3,
            content: {
              body: '* Streamed reply',
              msgtype: 'm.text',
              'm.new_content': { body: 'Streamed reply', msgtype: 'm.text' },
              'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
            },
          })
        )
      );
      expect(renderer!.root.findAllByType('span').map((node) => node.children.join(''))).toContain(
        'Streamed reply'
      );
      if (mode === 'arriving') {
        await act(async () => timelineSet.resetLiveTimeline());
        expect(state.threadEvents).toEqual([root]);
        expect(state.threadInitialRenderMode).toBe('cached');
      }
    } finally {
      act(() => renderer?.unmount());
      vi.restoreAllMocks();
      Thread.hasServerSideSupport = support;
    }
    expect(thread.listenerCount(RoomEvent.Timeline)).toBe(listenerCount);
    expect(thread.listenerCount(RoomEvent.TimelineReset)).toBe(resetListenerCount);
  }
);
