import { Direction, MatrixClient, MatrixEvent, RelationType } from 'matrix-js-sdk';
import {
  MINDROOM_TOOL_APPROVAL_EVENT,
  isUndecryptedApprovalCandidate,
} from '../messages/toolApproval';
import { createPreferLiveEventMapper } from '../threads/eventRepository';
import { BackfillScheduler } from './backfillScheduler';

export const enqueueThreadApprovalBackfill = (
  mx: MatrixClient,
  scheduler: BackfillScheduler,
  roomId: string,
  threadId: string,
  repairOrigins?: readonly MatrixEvent[],
  retainedEvents: readonly MatrixEvent[] = []
): Promise<{ events: MatrixEvent[]; repairedEventIds: string[]; error?: string }> =>
  scheduler.enqueue({
    roomId,
    threadId,
    kind: 'thread-approvals',
    priority: 0,
    execute: async (signal) => {
      const collected: MatrixEvent[] = [];
      const repairedEventIds: string[] = [];
      let decryptionFailed = false;
      const room = mx.getRoom(roomId);
      if (!room)
        return { events: collected, repairedEventIds, error: 'Approval room is unavailable.' };
      const mapEvent = createPreferLiveEventMapper(room, mx.getEventMapper({ decrypt: false }));
      const eventType = room.hasEncryptionStateEvent() ? null : MINDROOM_TOOL_APPROVAL_EVENT;
      const fetchPages = async (target: string, relation: RelationType): Promise<MatrixEvent[]> => {
        const events: MatrixEvent[] = [];
        let from: string | undefined;
        const seen = new Set<string>();
        do {
          if (signal.aborted) return events;
          const page = await mx.fetchRelations(roomId, target, relation, eventType, {
            dir: Direction.Backward,
            limit: 100,
            ...(from ? { from } : {}),
          });
          if (signal.aborted) return events;
          const mapped = page.chunk.map((raw) => mapEvent({ ...raw, room_id: roomId }));
          const decryptions = await Promise.allSettled(
            mapped.map((event) => mx.decryptEventIfNeeded(event))
          );
          decryptionFailed ||= decryptions.some((result) => result.status === 'rejected');
          if (signal.aborted) return events;
          // Keep unavailable ciphertext: the provider owns late-key subscriptions.
          const relevant = mapped.filter(
            (event) =>
              event.getType() === MINDROOM_TOOL_APPROVAL_EVENT ||
              isUndecryptedApprovalCandidate(event)
          );
          collected.push(...relevant);
          events.push(...relevant);
          from = page.next_batch ?? undefined;
          if (from && seen.has(from))
            throw new Error('Approval history pagination did not advance');
          if (from) seen.add(from);
        } while (from);
        return events;
      };
      try {
        const origins = repairOrigins ?? (await fetchPages(threadId, RelationType.Thread));
        for (const event of origins) {
          if (signal.aborted) break;
          if (event.getType() !== MINDROOM_TOOL_APPROVAL_EVENT) continue;
          const id = event.getId();
          const content = event.getOriginalContent();
          if (id && (content.status === 'pending' || content.auto_approval))
            await fetchPages(id, RelationType.Replace);
          if (id) repairedEventIds.push(id);
        }
        // Relations omit redacted children. Refresh omitted retained events by ID
        // to learn explicit redactions without deleting concurrent live arrivals.
        const fetchedIds = new Set(collected.map((event) => event.getId()));
        const repairIds = repairOrigins && new Set(repairOrigins.map((event) => event.getId()));
        for (const retained of retainedEvents) {
          if (signal.aborted || decryptionFailed) break;
          const id = retained.getId();
          const relation = retained.getRelation();
          if (!id || fetchedIds.has(id) || retained.isRedacted() || retained.isRedaction())
            continue;
          if (
            repairIds &&
            (relation?.rel_type !== RelationType.Replace || !repairIds.has(relation.event_id))
          )
            continue;
          const refreshed = mapEvent({ ...(await mx.fetchRoomEvent(roomId, id)), room_id: roomId });
          if (signal.aborted) break;
          await mx.decryptEventIfNeeded(refreshed);
          collected.push(refreshed);
        }
        return {
          events: collected,
          repairedEventIds,
          ...(decryptionFailed ? { error: 'Some approval history could not be decrypted.' } : {}),
        };
      } catch {
        return {
          events: collected,
          repairedEventIds,
          error: 'Some approval history could not be loaded.',
        };
      }
    },
  });
