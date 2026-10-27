import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  emitClientSync,
  flushAsyncWork,
  getClickableByText,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  reactionOrEditEventMock,
  roomTimelineVirtualizerState,
  roomThreadOverviewType,
  roomUnreadState,
  scrollToItemMock,
  settingsState,
  threadResolutionMapMock,
  virtualPaginatorState,
} from '../test-utils/RoomTimeline.test.shared';

describe('RoomTimeline', () => {
  describe('navigation and focus', () => {
    describe('navigation and hidden-event recovery', () => {
      describe('filter navigation', () => {
        it('keeps the default overview range when reset restores default sorting', async () => {
          vi.useFakeTimers();
          const previousPrefetchDepth = settingsState.prefetchDepth;
          const windowLimit = 50;
          settingsState.prefetchDepth = windowLimit;
          try {
            const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
            const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
            const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
            const liveEvents = Array.from({ length: windowLimit - 1 }, (_, index) =>
              makeEvent(`$message-${index}`)
            );
            liveEvents.push(unresolvedThread);
            const room = makeRoom({ liveEvents });
            let renderer: ReturnType<typeof create> | undefined;

            await act(async () => {
              renderer = create(
                React.createElement(ControlledRoomTimeline, {
                  room,
                })
              );
              await flushAsyncWork(1);
            });

            await act(async () => {
              virtualPaginatorState.lastOptions?.onRangeChange({ start: 0, end: 10 });
              await flushAsyncWork(1);
            });

            await act(async () => {
              renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
              renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
              await flushAsyncWork(1);
            });

            await act(async () => {
              vi.advanceTimersByTime(350);
              await flushAsyncWork(2);
            });

            expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 1 });

            await act(async () => {
              renderer?.root.findByType(roomThreadOverviewType).props.onReset();
              await flushAsyncWork(1);
            });

            await act(async () => {
              vi.advanceTimersByTime(350);
              await flushAsyncWork(2);
            });

            expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 1 });
          } finally {
            settingsState.prefetchDepth = previousPrefetchDepth;
            vi.useRealTimers();
          }
        }, 10000);

  it('keeps the active filter when jumping to an unread event hidden by the overview', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const unreadMessage = makeEvent('$unread-message');
    const liveEvents = [resolvedThread];
    const unreadTimeline = makeTimeline([unreadMessage]);
    const room = makeRoom({
      liveEvents,
      timelinesByEventId: new Map([[unreadMessage.getId(), unreadTimeline]]),
    });
    room.getEventReadUpTo = () => unreadMessage.getId();
    roomUnreadState.value = true;
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
    matrixClientMock.getEventTimeline.mockResolvedValue(unreadTimeline);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');

    const jumpToUnread = getClickableByText(renderer!, 'Jump to Unread');

    await act(async () => {
      jumpToUnread.props.onClick();
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      unreadMessage.getId()
    );
  });

  it('maps hidden event targets to a visible neighbor instead of filtered index zero', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const threadRoot = makeEvent('$thread-root', { ts: 2 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: threadRoot.getId(),
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    const targetTimeline = makeTimeline([olderMessage, threadRoot, hiddenReply, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: threadRoot.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('falls back to the closest renderable entry when all target candidates are hidden', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const hiddenEdit = makeEvent('$edit', {
      associatedId: hiddenReply.getId(),
      relation: { rel_type: 'm.replace', event_id: hiddenReply.getId() },
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const targetTimeline = makeTimeline([olderMessage, hiddenReply, hiddenEdit, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenEdit.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenEdit.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: newerMessage.getId(),
      index: 1,
      absoluteIndex: 3,
    });
  });

  it('falls back to the last renderable entry when read-up-to is beyond all visible events', async () => {
    const { getUnreadTargetAnchor } = await import('../timelineScrollUtils');
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const firstVisible = makeEvent('$first', { ts: 1 });
    const lastVisible = makeEvent('$last', { ts: 2 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 3,
    });
    const targetTimeline = makeTimeline([firstVisible, lastVisible, hiddenReply]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getUnreadTargetAnchor({
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: lastVisible.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('scrolls to the next visible event when read-up-to is filtered out in the live timeline', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const visibleRead = makeEvent('$visible-read', { ts: 1 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const unreadVisible = makeEvent('$visible-unread', {
      sender: '@bob:example.org',
      ts: 3,
    });
    const room = makeRoom({
      liveEvents: [visibleRead, hiddenReply, unreadVisible],
    });
    room.getEventReadUpTo = () => hiddenReply.getId();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    await act(async () => {
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalledWith(1, {
      align: 'start',
      behavior: 'auto',
    });
  });

  it('switches back to all threads before opening an eventId hidden by the active filter', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const permalinkMessage = makeEvent('$permalink-message');
    const targetTimeline = makeTimeline([permalinkMessage]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [resolvedThread],
      findEventById: (eventId) => {
        if (eventId === permalinkMessage.getId()) {
          return targetTimelineLoaded ? permalinkMessage : undefined;
        }

        return eventId === resolvedThread.getId() ? resolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === permalinkMessage.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: permalinkMessage.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      permalinkMessage.getId()
    );
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledTimes(1);
  });

  it('keeps the active thread filter when opening an unloaded eventId that still matches it', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleResolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderResolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderResolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleResolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderResolvedThread.getId()) {
          return targetTimelineLoaded ? olderResolvedThread : undefined;
        }

        return eventId === visibleResolvedThread.getId() ? visibleResolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(visibleResolvedThread.getId(), { isResolved: true, tags: null });
    threadResolutionMapMock.set(olderResolvedThread.getId(), { isResolved: true, tags: null });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderResolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderResolvedThread.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderResolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded unresolved thread root', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderUnresolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderUnresolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderUnresolvedThread.getId()) {
          return targetTimelineLoaded ? olderUnresolvedThread : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderUnresolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderUnresolvedThread.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderUnresolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded fallback-only thread root after permalink load', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const fallbackThreadRoot = makeEvent('$thread-fallback');
    const fallbackThreadReply = makeEvent('$thread-fallback-reply', {
      threadRootId: fallbackThreadRoot.getId(),
    });
    const targetTimeline = makeTimeline([fallbackThreadRoot, fallbackThreadReply]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === fallbackThreadRoot.getId()) {
          return targetTimelineLoaded ? fallbackThreadRoot : undefined;
        }
        if (eventId === fallbackThreadReply.getId()) {
          return targetTimelineLoaded ? fallbackThreadReply : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === fallbackThreadRoot.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: fallbackThreadRoot.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      fallbackThreadRoot.getId()
    );
  });

  it('detects unread divider boundaries when read-up-to is filtered out', async () => {
    const { shouldRenderUnreadDividerAt } = await import(
      '../timelineScrollUtils'
    );

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 2,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(true);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 1,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(false);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 3,
        eventAbsoluteIndex: 5,
        prevRenderedEventAbsoluteIndex: 4,
      })
    ).toBe(false);
  });

      });

      describe('room focus retry handling', () => {
        it('does not retrigger room focus scroll on unrelated live room updates', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const unresolvedThread = makeEvent('$thread-root', { isThreadRoot: true });
    const unreadMessage = makeEvent('$unread-message');
    const unreadTimelineEvents = [unreadMessage];
    const unreadTimeline = makeTimeline(unreadTimelineEvents);
    const room = makeRoom({
      liveEvents: [unresolvedThread],
      timelinesByEventId: new Map([[unreadMessage.getId(), unreadTimeline]]),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    room.getEventReadUpTo = () => unreadMessage.getId();
    roomUnreadState.value = true;
    matrixClientMock.getEventTimeline.mockResolvedValue(unreadTimeline);

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    const jumpToUnread = getClickableByText(renderer!, 'Jump to Unread');

    await act(async () => {
      jumpToUnread.props.onClick();
      await flushAsyncWork();
    });

    const initialScrollCallCount = scrollToItemMock.mock.calls.length;
    expect(initialScrollCallCount).toBeGreaterThan(0);
    expect(scrollToItemMock).toHaveBeenLastCalledWith(0, {
      align: 'start',
      behavior: 'instant',
      offset: 32,
      stopInView: false,
    });

    unreadTimelineEvents.push(makeEvent('$later-event', { ts: 10 }));

    await act(async () => {
      renderer?.update(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(scrollToItemMock).toHaveBeenCalledTimes(initialScrollCallCount);

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('tracks room-mode focus retries while the target event is still missing from the DOM', async () => {
    const { getNextRoomFocusRetry } = await import('../timelineScrollUtils');

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: undefined,
        scrolled: true,
        targetFound: false,
      })
    ).toEqual({
      eventId: '$target',
      attempts: 1,
    });

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: {
          eventId: '$target',
          attempts: 1,
        },
        scrolled: true,
        targetFound: false,
      })
    ).toEqual({
      eventId: '$target',
      attempts: 2,
    });

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: {
          eventId: '$target',
          attempts: 10,
        },
        scrolled: true,
        targetFound: false,
      })
    ).toBeUndefined();

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: undefined,
        scrolled: true,
        targetFound: true,
      })
    ).toBeUndefined();
  });

  it('maps hidden event targets to a visible neighbor instead of filtered index zero', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const threadRoot = makeEvent('$thread-root', { ts: 2 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: threadRoot.getId(),
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    const targetTimeline = makeTimeline([olderMessage, threadRoot, hiddenReply, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: threadRoot.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('falls back to the closest renderable entry when all target candidates are hidden', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const hiddenEdit = makeEvent('$edit', {
      associatedId: hiddenReply.getId(),
      relation: { rel_type: 'm.replace', event_id: hiddenReply.getId() },
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const targetTimeline = makeTimeline([olderMessage, hiddenReply, hiddenEdit, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenEdit.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenEdit.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: newerMessage.getId(),
      index: 1,
      absoluteIndex: 3,
    });
  });

  it('falls back to the last renderable entry when read-up-to is beyond all visible events', async () => {
    const { getUnreadTargetAnchor } = await import('../timelineScrollUtils');
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const firstVisible = makeEvent('$first', { ts: 1 });
    const lastVisible = makeEvent('$last', { ts: 2 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 3,
    });
    const targetTimeline = makeTimeline([firstVisible, lastVisible, hiddenReply]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getUnreadTargetAnchor({
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: lastVisible.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('scrolls to the next visible event when read-up-to is filtered out in the live timeline', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const visibleRead = makeEvent('$visible-read', { ts: 1 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const unreadVisible = makeEvent('$visible-unread', {
      sender: '@bob:example.org',
      ts: 3,
    });
    const room = makeRoom({
      liveEvents: [visibleRead, hiddenReply, unreadVisible],
    });
    room.getEventReadUpTo = () => hiddenReply.getId();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    await act(async () => {
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalledWith(1, {
      align: 'start',
      behavior: 'auto',
    });
  });

  it('switches back to all threads before opening an eventId hidden by the active filter', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const permalinkMessage = makeEvent('$permalink-message');
    const targetTimeline = makeTimeline([permalinkMessage]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [resolvedThread],
      findEventById: (eventId) => {
        if (eventId === permalinkMessage.getId()) {
          return targetTimelineLoaded ? permalinkMessage : undefined;
        }

        return eventId === resolvedThread.getId() ? resolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === permalinkMessage.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: permalinkMessage.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      permalinkMessage.getId()
    );
  });

  it('keeps the active thread filter when opening an unloaded eventId that still matches it', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleResolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderResolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderResolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleResolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderResolvedThread.getId()) {
          return targetTimelineLoaded ? olderResolvedThread : undefined;
        }

        return eventId === visibleResolvedThread.getId() ? visibleResolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(visibleResolvedThread.getId(), { isResolved: true, tags: null });
    threadResolutionMapMock.set(olderResolvedThread.getId(), { isResolved: true, tags: null });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderResolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderResolvedThread.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderResolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded unresolved thread root', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderUnresolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderUnresolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderUnresolvedThread.getId()) {
          return targetTimelineLoaded ? olderUnresolvedThread : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderUnresolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderUnresolvedThread.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderUnresolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded fallback-only thread root after permalink load', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const fallbackThreadRoot = makeEvent('$thread-fallback');
    const fallbackThreadReply = makeEvent('$thread-fallback-reply', {
      threadRootId: fallbackThreadRoot.getId(),
    });
    const targetTimeline = makeTimeline([fallbackThreadRoot, fallbackThreadReply]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === fallbackThreadRoot.getId()) {
          return targetTimelineLoaded ? fallbackThreadRoot : undefined;
        }
        if (eventId === fallbackThreadReply.getId()) {
          return targetTimelineLoaded ? fallbackThreadReply : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === fallbackThreadRoot.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: fallbackThreadRoot.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      emitClientSync();
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      fallbackThreadRoot.getId()
    );
  });

  it('detects unread divider boundaries when read-up-to is filtered out', async () => {
    const { shouldRenderUnreadDividerAt } = await import(
      '../timelineScrollUtils'
    );

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 2,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(true);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 1,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(false);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 3,
        eventAbsoluteIndex: 5,
        prevRenderedEventAbsoluteIndex: 4,
      })
    ).toBe(false);
  });

      });
    });
  });
});
