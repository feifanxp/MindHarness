import type { ThreadFilterState } from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';

export const DIRECT_ROOM_TIMELINE_FILTER_STATE: ThreadFilterState = {
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
};

export const THREAD_OVERVIEW_METADATA_CACHE_LIMIT = 64;

export type RoomTimelineViewState = {
  effectiveViewMode: RoomViewMode;
  focusedRoomOverviewRequested: boolean;
  requestedThreadFilterState: ThreadFilterState;
  showRoomThreadOverviewControls: boolean;
};

export const resolveRoomTimelineViewState = ({
  eventId,
  focusEventInRoom,
  threadFilterState,
  threadId,
  viewMode,
}: {
  eventId?: string;
  focusEventInRoom?: boolean;
  threadFilterState: ThreadFilterState;
  threadId?: string;
  viewMode: RoomViewMode;
}): RoomTimelineViewState => ({
  effectiveViewMode: viewMode,
  focusedRoomOverviewRequested: Boolean(
    !threadId && focusEventInRoom && viewMode === 'threaded' && eventId
  ),
  requestedThreadFilterState:
    viewMode === 'classic' ? DIRECT_ROOM_TIMELINE_FILTER_STATE : threadFilterState,
  showRoomThreadOverviewControls: !threadId && viewMode !== 'classic',
});
