import { useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import {
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  SyncState,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { hydrateLoadedEvent, useFetchRoomEvent } from './useRoomEvent';
import { usePinnedEventIds } from './useThreadPinning';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
import { hydrateCachedEvents } from './eventCacheEditUtils';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSyncState } from '../../hooks/useSyncState';

const collectEvents = (results: UseQueryResult<MatrixEvent>[]) =>
  results.map((result) => result.data);

/** Pins can outlive the loaded room timeline, including roots with no replies. */
export const usePinnedThreadEvents = (
  room: Room,
  enabled: boolean,
  revision = 0
): MatrixEvent[] => {
  const pinnedEventIds = usePinnedEventIds(room);
  const fetchEvent = useFetchRoomEvent(room);
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const [relationVersion, refreshRelations] = useForceUpdate();
  const [revalidation, revalidate] = useForceUpdate();
  useSyncState(
    mx,
    useCallback(
      (state, previous) => {
        if (
          state === SyncState.Prepared ||
          (state === SyncState.Syncing && previous !== SyncState.Syncing)
        )
          revalidate();
      },
      [revalidate]
    )
  );
  const fetched = useQueries({
    queries: pinnedEventIds.map((eventId) => ({
      queryKey: [room.roomId, eventId, undefined],
      queryFn: () => fetchEvent(eventId),
      enabled: enabled && !room.findEventById(eventId),
      staleTime: Infinity,
      gcTime: 60 * 60 * 1000,
      retry: (failureCount: number, error: unknown) =>
        (error as { errcode?: string })?.errcode !== 'M_NOT_FOUND' && failureCount < 3,
    })),
    combine: collectEvents,
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const refresh = async (eventId: string) => {
      if (room.findEventById(eventId)) return;
      const queryKey = [room.roomId, eventId, undefined];
      try {
        // Publish the cached copy first; detached roots also need an authoritative refresh.
        const before = await queryClient.ensureQueryData({
          queryKey,
          queryFn: () => fetchEvent(eventId),
          staleTime: Infinity,
        });
        if (cancelled || room.findEventById(eventId)) return;
        const beforeContent = before.getContent();
        const fresh = await hydrateLoadedEvent(mx, await mx.fetchRoomEvent(room.roomId, eventId));
        if (cancelled || room.findEventById(eventId)) return;
        const current = queryClient.getQueryData<MatrixEvent>(queryKey);
        // Preserve edits/deletions delivered while the request was in flight.
        if (
          fresh.isRedacted() ||
          (!fresh.isDecryptionFailure() &&
            current === before &&
            !current.isRedacted() &&
            current.getContent() === beforeContent)
        ) {
          queryClient.setQueryData(queryKey, fresh);
        }
      } catch {
        // Offline pins keep their cached content and refresh when sync resumes.
      }
    };
    pinnedEventIds.forEach((eventId) => {
      void refresh(eventId);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, pinnedEventIds, room, mx, queryClient, fetchEvent, revalidation]);
  useEffect(() => {
    if (!enabled) return undefined;
    const roots = pinnedEventIds
      .map((id, index) => room.findEventById(id) ?? fetched[index])
      .filter((event): event is MatrixEvent => !!event);
    if (roots.length === 0) return undefined;
    const observed = new Set<MatrixEvent>();
    const reconcile = () => {
      const before = roots.map((root) => [root.isRedacted(), root.replacingEvent()?.getId()]);
      // Query-loaded roots need the same edit/redaction hydration as cached timeline events.
      const replacements = roots
        .map((event) => event.replacingEvent())
        .filter((event): event is MatrixEvent => !!event);
      const loaded = room
        .getUnfilteredTimelineSet()
        .getTimelines()
        .flatMap((timeline) => timeline.getEvents());
      const rootIds = new Set(roots.map((root) => root.getId()));
      const edits = loaded.filter(
        (event) =>
          event.getRelation()?.rel_type === RelationType.Replace &&
          rootIds.has(event.getRelation()?.event_id)
      );
      const replacementsAndEdits = [...replacements, ...edits];
      [...roots, ...replacementsAndEdits].forEach((event) => {
        if (observed.has(event)) return;
        observed.add(event);
        event.on(MatrixEventEvent.Decrypted, refreshRelations);
      });
      const targetIds = new Set([
        ...rootIds,
        ...replacementsAndEdits.map((event) => event.getId()),
      ]);
      const redactions = loaded.filter(
        (event) => event.isRedaction() && targetIds.has(event.getAssociatedId())
      );
      hydrateCachedEvents({
        room,
        events: [
          ...roots,
          ...replacementsAndEdits.filter(
            (event) =>
              !event.isEncrypted() ||
              (event.getClearContent() !== null && !event.isDecryptionFailure())
          ),
          ...redactions,
        ],
      });
      return roots.some(
        (root, index) =>
          root.isRedacted() !== before[index][0] ||
          root.replacingEvent()?.getId() !== before[index][1]
      );
    };
    const handleEvent = (event: MatrixEvent) => {
      const targetId = event.getAssociatedId();
      if (
        targetId &&
        roots.some(
          (root) => root.getId() === targetId || root.replacingEvent()?.getId() === targetId
        )
      ) {
        reconcile();
        refreshRelations();
      }
    };
    if (reconcile()) refreshRelations();
    room.on(RoomEvent.Timeline, handleEvent);
    room.on(RoomEvent.Redaction, handleEvent);
    return () => {
      observed.forEach((event) =>
        event.removeListener(MatrixEventEvent.Decrypted, refreshRelations)
      );
      room.removeListener(RoomEvent.Timeline, handleEvent);
      room.removeListener(RoomEvent.Redaction, handleEvent);
    };
  }, [enabled, pinnedEventIds, room, fetched, revision, relationVersion, refreshRelations]);
  return useMemo(() => {
    // SDK rooms retain their identity when newer live events replace cached copies.
    void revision;
    void relationVersion;
    return enabled
      ? pinnedEventIds
          .map((id, index) => room.findEventById(id) ?? fetched[index])
          .filter(
            (event): event is MatrixEvent => !!event && isZeroReplyStandaloneThreadRootEvent(event)
          )
      : [];
  }, [enabled, pinnedEventIds, room, fetched, revision, relationVersion]);
};
