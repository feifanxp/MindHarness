import { describe, expect, it } from 'vitest';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';
import {
  DIRECT_ROOM_TIMELINE_FILTER_STATE,
  resolveRoomTimelineViewState,
  THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
} from './roomTimelineViewState';

describe('resolveRoomTimelineViewState', () => {
  it('preserves compact mode and overview controls for direct rooms', () => {
    const requested = createDefaultThreadFilterState();

    expect(
      resolveRoomTimelineViewState({
        eventId: '$event',
        focusEventInRoom: true,
        threadFilterState: requested,
        threadId: undefined,
        viewMode: 'compact',
      })
    ).toEqual({
      effectiveViewMode: 'compact',
      focusedRoomOverviewRequested: false,
      requestedThreadFilterState: requested,
      showRoomThreadOverviewControls: true,
    });
  });

  it('preserves requested overview state for non-direct room overview routes', () => {
    const requested = createDefaultThreadFilterState();

    expect(
      resolveRoomTimelineViewState({
        eventId: '$event',
        focusEventInRoom: true,
        threadFilterState: requested,
        threadId: undefined,
        viewMode: 'threaded',
      })
    ).toEqual({
      effectiveViewMode: 'threaded',
      focusedRoomOverviewRequested: true,
      requestedThreadFilterState: requested,
      showRoomThreadOverviewControls: true,
    });
  });

  it('does not request room overview focus inside an active thread', () => {
    const requested = createDefaultThreadFilterState();

    expect(
      resolveRoomTimelineViewState({
        eventId: '$event',
        focusEventInRoom: true,
        threadFilterState: requested,
        threadId: '$thread',
        viewMode: 'threaded',
      })
    ).toMatchObject({
      focusedRoomOverviewRequested: false,
      showRoomThreadOverviewControls: false,
    });
  });

  it('uses neutral filters and hides overview controls in classic mode', () => {
    const requested = {
      ...createDefaultThreadFilterState(),
      freeText: 'needle',
    };

    expect(
      resolveRoomTimelineViewState({
        eventId: undefined,
        focusEventInRoom: false,
        threadFilterState: requested,
        threadId: undefined,
        viewMode: 'classic',
      })
    ).toEqual({
      effectiveViewMode: 'classic',
      focusedRoomOverviewRequested: false,
      requestedThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
      showRoomThreadOverviewControls: false,
    });
  });

  it('keeps the overview metadata cache limit explicit', () => {
    expect(THREAD_OVERVIEW_METADATA_CACHE_LIMIT).toBe(64);
  });
});
