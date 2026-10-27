/**
 * CINNY-207 P3.1: MindroomSyncEngine — shared types.
 *
 * The engine is a client-level singleton that owns every Tier-1 write
 * (D2). It is created alongside the Matrix client and torn down on
 * logout, independent of which room is mounted in the UI. This module
 * is the type surface shared between the engine core, its write-through
 * layer, and the React context wrapper.
 */

import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { EnginePersistFacade } from './enginePersistFacade';
import type { BackfillScheduler } from './backfillScheduler';
import type { OfflineRoomController } from './roomOffline';

/**
 * Live event dispatch metadata as observed by the engine. This is a
 * strict subset of what `RoomEvent.Timeline` exposes plus a
 * classification tag so downstream code (write-through, gap tracker)
 * does not need to sniff event types twice.
 */
export type EngineLiveEventMeta =
  | {
      readonly kind: 'timeline';
      readonly roomId: string;
      readonly liveEvent: true;
      readonly toStartOfTimeline: false;
    }
  | {
      readonly kind: 'redaction';
      readonly roomId: string;
      readonly liveEvent: true;
      readonly toStartOfTimeline: false;
      /**
       * CINNY-207 P3 gate re-fix (layer 2): the third arg of the
       * `RoomEvent.Redaction` emission — matrix-js-sdk captures the
       * redacted target's `threadRootId` BEFORE pruning, so this is a
       * reliable pre-prune attribution hint the write-through hands
       * straight to `planRedactionCacheCleanup`. Absent for
       * genuinely non-threaded redactions and for the second entry
       * point (Timeline-channel re-emit) where the SDK does not
       * supply it.
       */
      readonly sdkThreadId?: string;
    };

export type EngineLiveEventHandler = (
  event: MatrixEvent,
  room: Room,
  meta: EngineLiveEventMeta
) => void;

export type EngineLifecycle = {
  start(): void;
  stop(): void;
};

export type MindroomSyncEngine = EngineLifecycle & {
  readonly offline: OfflineRoomController;
  clearRoomFocus(roomId: string): void;
  backgroundPageAllowance(roomId: string): number;
  /**
   * The Matrix client this engine wraps. Kept on the instance so
   * downstream layers can call SDK helpers without an extra prop.
   */
  readonly mx: MatrixClient;
  /**
   * The MindRoom cache session id derived from the client's baseUrl
   * and safe user id (matches the id used everywhere else — see
   * `createSessionId` in `state/sessions.ts`). Included on the
   * instance so consumers do not each recompute it.
   */
  readonly sessionId: string;
  /**
   * True once the client has reached a live sync state (Prepared,
   * Syncing, or Catchup) at least once. Deliberately does not flip
   * back to false on Reconnecting/Error — reconnect events are the
   * ones we most want to persist. Only teardown (stop()) resets it.
   */
  isLiveMode(): boolean;
  /**
   * Persist facade exposed to the React tree. CINNY-207 P3.3 rewires
   * the fetch controllers off the deleted
   * `useThreadCachePersistenceController` onto `engine.persist` —
   * signatures match the pre-strip props, only the wiring changed.
   */
  readonly persist: EnginePersistFacade;
  /**
   * CINNY-207 P4.1: the client-scoped backfill scheduler that
   * serializes every backfill-shaped network fetch (gap-fill,
   * room-deep-history, thread-backfill, thread-seed). Enforces AC8
   * (no duplicate in-flight jobs per (room, thread, kind)) and a
   * concurrency cap. Callers submit executor callbacks; the scheduler
   * hands each an AbortSignal for cooperative cancellation. Only P4.2+
   * wires actual fetches to it; P4.1 lands the queue and dedup.
   */
  readonly scheduler: BackfillScheduler;
  /** Notify mounted readers after a recovered room page commits to the cache. */
  subscribeRoomRecovery(roomId: string, listener: () => void): () => void;
  /**
   * CINNY-207 P4.2: consolidated per-room "you are here" hook. Called
   * from `MindroomRoomTimeline` whenever the mounted room changes (or
   * the currently-open thread changes). Idempotent; runs the ledger
   * federation stamp (D3), eviction protection registry update, and
   * lastOpenedTs bumps for both the room and thread scopes. Kept as a
   * method rather than a hook so non-React callers can invoke it too.
   */
  noteRoomFocused(roomId: string, threadId?: string): void;
};
