import { describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom, makeTimeline } from './test-utils/RoomTimeline.test.shared';
import { runThreadOpenTargetEvent } from './threadOpenTargetEvent';

describe('runThreadOpenTargetEvent', () => {
  it('loads targeted event context into the thread timeline and queues pending scroll', async () => {
    const root = makeEvent('$root', { isThreadRoot: true });
    const threadTimeline = makeTimeline([]);
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
    };
    const thread = {
      id: '$root',
      rootEvent: root,
      getUnfilteredTimelineSet: () => threadTimelineSet,
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    const pending = vi.fn();
    const notifyEventsChanged = vi.fn();
    const mx = {
      getEventTimeline: vi.fn(async () => threadTimeline),
    };

    const shouldContinue = await runThreadOpenTargetEvent({
      eventId: '$reply',
      notifyEventsChanged,
      isCurrentThreadOpen: () => true,
      mx: mx as never,
      room: room as never,
      targets: { queue: pending } as never,
      shouldScrollToLatestOnOpen: false,
      threadId: '$root',
    });

    expect(shouldContinue).toBe(true);
    expect(mx.getEventTimeline).toHaveBeenCalledWith(threadTimelineSet, '$reply');
    expect(notifyEventsChanged).toHaveBeenCalledTimes(1);
    expect(pending).toHaveBeenCalledWith({
      threadId: '$root',
      eventId: '$reply',
      highlight: true,
      onScroll: undefined,
    });
  });

  it('does not queue target scroll for latest opens or root-event opens', async () => {
    const room = makeRoom();
    const pending = vi.fn();
    const mx = { getEventTimeline: vi.fn() };

    await expect(
      runThreadOpenTargetEvent({
        eventId: undefined,
        notifyEventsChanged: vi.fn(),
        isCurrentThreadOpen: () => true,
        mx: mx as never,
        room: room as never,
        targets: { queue: pending } as never,
        shouldScrollToLatestOnOpen: true,
        threadId: '$root',
      })
    ).resolves.toBe(true);

    await expect(
      runThreadOpenTargetEvent({
        eventId: '$root',
        notifyEventsChanged: vi.fn(),
        isCurrentThreadOpen: () => true,
        mx: mx as never,
        room: room as never,
        targets: { queue: pending } as never,
        shouldScrollToLatestOnOpen: false,
        threadId: '$root',
      })
    ).resolves.toBe(true);

    expect(mx.getEventTimeline).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
  });

  it('aborts without queuing scroll when the thread route changes during context load', async () => {
    const root = makeEvent('$root', { isThreadRoot: true });
    const thread = {
      id: '$root',
      rootEvent: root,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => makeTimeline([]),
      }),
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    const pending = vi.fn();
    const mx = {
      getEventTimeline: vi.fn(async () => makeTimeline([])),
    };

    const shouldContinue = await runThreadOpenTargetEvent({
      eventId: '$reply',
      notifyEventsChanged: vi.fn(),
      isCurrentThreadOpen: () => false,
      mx: mx as never,
      room: room as never,
      targets: { queue: pending } as never,
      shouldScrollToLatestOnOpen: false,
      threadId: '$root',
    });

    expect(shouldContinue).toBe(false);
    expect(pending).not.toHaveBeenCalled();
  });
});
