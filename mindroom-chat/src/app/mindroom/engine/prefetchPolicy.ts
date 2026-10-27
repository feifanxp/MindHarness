/** Background scope policy. Focus is the default; all rooms is explicit opt-in.
 * Legacy homeserver tiers remain readable for older settings and ledger data.
 * Engine jobs decrypt through the SDK and enforce connectivity and allowance. */

import type { MatrixClient, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { getStateEvent } from '../../utils/room';

// ---------- Public constants (D3) ----------

/**
 * The scope of every prefetch job in v1: only rooms whose create event
 * came from our own homeserver. Federated rooms are skipped unless the
 * user explicitly opens them (which enqueues a band-0 job).
 */
export const PREFETCH_SCOPE = 'my-server' as const;

/** Stored scope values; v1 homeserver preferences migrate to focused rooms. */
export type PrefetchScope = 'my-server' | 'all-rooms' | 'current-room-only';
export const DEFAULT_PREFETCH_SCOPE: PrefetchScope = 'current-room-only';
const PREFETCH_SCOPE_VALUES: ReadonlyArray<PrefetchScope> = [
  'my-server',
  'all-rooms',
  'current-room-only',
];

/**
 * Depth (in raw events) of the background room-tail prefetch job for
 * my-server rooms other than the currently focused one. Kept modest
 * so a fresh session doesn't hammer the server.
 */
export const ROOM_TAIL_PREFETCH_DEPTH = 200;

/**
 * Target depth (in raw events) of the current-room deep-history sweep
 * — the band-4 job that replaces the removed eager-preload loop
 * (P4.3). Sized generously: this is the room the user is looking at,
 * so we make scrollback and search inside it feel bottomless.
 */
export const CURRENT_ROOM_DEEP_HISTORY_TARGET = 10_000;

// ---------- Room create sender domain ----------

/**
 * The domain segment of a Matrix user id (`@name:domain` or
 * `@name:domain:port` → `domain[:port]`). Returns `undefined` for
 * anything that doesn't look like a user id — the `substring after
 * first ':'` semantics tolerate ports and colons in the domain.
 */
const senderDomainOf = (senderId: string | undefined | null): string | undefined => {
  if (typeof senderId !== 'string' || senderId.length === 0) return undefined;
  const colon = senderId.indexOf(':');
  if (colon < 0 || colon === senderId.length - 1) return undefined;
  return senderId.slice(colon + 1);
};

// ---------- Tier resolution ----------

/**
 * `own`: room was created by a user on our homeserver — eligible for
 * every prefetch band the scheduler offers.
 * `federated`: create event came from another homeserver — the
 * scheduler skips this room for background bands (1-3). The user can
 * still trigger a band-0 job by opening it.
 * `background`: create event is missing entirely. Treated as
 * federated for eligibility purposes, but tagged separately so the
 * ledger `federated=true` flag doesn't get set on a room whose
 * membership we simply haven't confirmed yet.
 */
export type RoomPrefetchTier = 'own' | 'federated' | 'background';

/**
 * Resolve a room's prefetch tier. Never parses the room id — reads the
 * create event's sender domain and compares to our homeserver domain.
 * Room v12 / MSC4291 opaque room ids are handled transparently
 * because we never touch the id.
 */
export const resolveRoomPrefetchTier = (mx: MatrixClient, room: Room): RoomPrefetchTier => {
  const ourDomain = mx.getDomain?.();
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const senderDomain = senderDomainOf(createEvent?.getSender?.());
  if (!senderDomain) return 'background';
  if (!ourDomain) return 'federated';
  return senderDomain === ourDomain ? 'own' : 'federated';
};

/** Legacy homeserver-tier eligibility; encrypted pages use SDK decryption. */
export const isRoomEligibleForRawFetch = (
  mx: MatrixClient,
  room: Room,
  tier: RoomPrefetchTier = resolveRoomPrefetchTier(mx, room)
): boolean => {
  if (tier !== 'own') return false;
  return true;
};

// ---------- User settings resolvers (Phase 6.1 / D4) ----------

/**
 * Coerce an arbitrary settings value into a valid `PrefetchScope`.
 * Anything not on the whitelist — including older enum values, hand-
 * edited JSON, or genuine `undefined` — becomes the default. Same
 * shape as the sanitizers in `state/settings.ts` (silent fallback,
 * not throwing) so a corrupted storage blob never crashes the app.
 */
export const sanitizePrefetchScope = (value: unknown): PrefetchScope => {
  if (typeof value !== 'string') return DEFAULT_PREFETCH_SCOPE;
  return (PREFETCH_SCOPE_VALUES as ReadonlyArray<string>).includes(value)
    ? (value as PrefetchScope)
    : DEFAULT_PREFETCH_SCOPE;
};

/**
 * Depth cap for the current-room deep-history sweep. Matches the shape
 * of the sanitizer P1.6 replaced (silent fallback, integer, clamp to
 * [ROOM_TAIL_PREFETCH_DEPTH, CURRENT_ROOM_DEEP_HISTORY_TARGET]).
 * The lower bound is ROOM_TAIL_PREFETCH_DEPTH (200) rather than the
 * legacy 50 because anything shallower defeats the "bottomless
 * scrollback" goal of the current-room job — the room-tail depth is
 * the smallest number that keeps the design coherent. The upper bound
 * is CURRENT_ROOM_DEEP_HISTORY_TARGET (10_000) — the same generous cap
 * the eager preload used, sized so a user opening a mid-history event
 * can still scroll around without a fresh fetch.
 */
export const sanitizePrefetchDepth = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CURRENT_ROOM_DEEP_HISTORY_TARGET;
  }
  return Math.min(
    Math.max(Math.trunc(value), ROOM_TAIL_PREFETCH_DEPTH),
    CURRENT_ROOM_DEEP_HISTORY_TARGET
  );
};

/**
 * Runtime background-prefetch policy. Depth is owned by the foreground
 * deep-history job and is not duplicated into this engine config.
 */
export type PrefetchConfig = {
  readonly scope: PrefetchScope;
};

/**
 * Pure resolver: build a `PrefetchConfig` from a settings snapshot.
 * Anything shape-adjacent works — the caller passes in whatever holds
 * `prefetchScope` and `prefetchDepth`, and the function coerces via
 * the sanitizers above. Kept pure so the engine's `noteRoomFocused` /
 * scheduler / tests can compute the same config off any snapshot
 * without pulling jotai into non-React modules.
 */
export const resolvePrefetchConfig = (settings: { prefetchScope?: unknown }): PrefetchConfig => ({
  scope: sanitizePrefetchScope(settings.prefetchScope),
});

/** Scope gate for automatic history and gap recovery. */
export const isRoomEligibleForBackgroundPrefetch = ({
  mx,
  room,
  scope,
  focusedRoomId,
}: {
  mx: MatrixClient;
  room: Room;
  scope: PrefetchScope;
  focusedRoomId: string | undefined;
}): boolean => {
  if (scope === 'current-room-only') {
    return focusedRoomId === room.roomId;
  }
  if (scope === 'all-rooms') {
    return true;
  }
  // Legacy homeserver scope.
  return resolveRoomPrefetchTier(mx, room) === 'own';
};
