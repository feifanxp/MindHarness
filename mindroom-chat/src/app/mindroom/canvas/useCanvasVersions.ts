import { useEffect, useRef, useState } from 'react';
import {
  Direction,
  EventType,
  RelationType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { readCanvasVersion, type LatestCanvas } from '../ui-actions/chatUiProtocol';
import { isEventOrderedAfter } from '../../utils/room';

const PAGE_SIZE = 50;
// Far more updates than a canvas gets; a longer history lists only its newest versions.
const MAX_PAGES = 10;

const known = (request: MatrixEvent, latest: LatestCanvas): LatestCanvas[] => {
  const original = readCanvasVersion(request, request);
  return original && original.revisionEventId !== latest.revisionEventId
    ? [original, latest]
    : [latest];
};

/** Every version of a canvas, oldest first: the request, then its valid edits in Matrix edit order. */
const fetchVersions = async (
  mx: MatrixClient,
  room: Room,
  request: MatrixEvent
): Promise<LatestCanvas[]> => {
  const eventId = request.getId()!;
  const edits: MatrixEvent[] = [];
  let from: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // The SDK decrypts edits in encrypted rooms and drops those by anyone but the request's sender.
    // eslint-disable-next-line no-await-in-loop
    const result = await mx.relations(
      room.roomId,
      eventId,
      RelationType.Replace,
      EventType.RoomMessage,
      { dir: Direction.Backward, limit: PAGE_SIZE, ...(from ? { from } : {}) }
    );
    edits.push(...result.events);
    if (!result.nextBatch) break;
    from = result.nextBatch;
  }
  edits.sort((a, b) => (isEventOrderedAfter(a, b) ? 1 : -1));
  return [request, ...edits].flatMap((event) => readCanvasVersion(request, event) ?? []);
};

/**
 * The versions a user can switch between. History loads from the server when the panel opens and
 * again after each update; until then, or if it cannot load, the original and latest versions stand.
 */
export function useCanvasVersions(
  mx: MatrixClient,
  room: Room,
  request: MatrixEvent,
  latest: LatestCanvas
): LatestCanvas[] {
  const [versions, setVersions] = useState(() => known(request, latest));
  // Deleted versions stay out even when a history load that started earlier still lists them.
  const deleted = useRef(new Set<string>());
  const latestId = latest.revisionEventId;
  useEffect(() => {
    let alive = true;
    setVersions((current) =>
      current.some((version) => version.revisionEventId === latestId)
        ? current
        : [...current, latest]
    );
    // A canvas never updated has no history to load.
    if (latestId !== request.getId()) {
      fetchVersions(mx, room, request)
        .then((fetched) => {
          const kept = fetched.filter((version) => !deleted.current.has(version.revisionEventId));
          // The history must end at the shown version; otherwise keep what is known.
          if (alive && kept.at(-1)?.revisionEventId === latestId) setVersions(kept);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // `latest` changes identity on every render; its ID marks a new version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, room, request, latestId]);
  useEffect(() => {
    // A deleted version leaves the list at once; a chosen one falls back to the latest. Versions come
    // from the server, so their edits may not be loaded, and only the timeline sees every deletion.
    const forget = (event: MatrixEvent) => {
      if (!event.isRedaction()) return;
      const redacted = event.event.redacts ?? event.getContent().redacts;
      if (typeof redacted !== 'string') return;
      deleted.current.add(redacted);
      setVersions((current) => current.filter((version) => version.revisionEventId !== redacted));
    };
    room.on(RoomEvent.Timeline, forget);
    return () => {
      room.off(RoomEvent.Timeline, forget);
    };
  }, [room]);
  return versions;
}
