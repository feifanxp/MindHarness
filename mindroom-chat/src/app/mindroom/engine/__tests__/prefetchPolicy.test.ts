import { describe, expect, it } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  CURRENT_ROOM_DEEP_HISTORY_TARGET,
  DEFAULT_PREFETCH_SCOPE,
  isRoomEligibleForBackgroundPrefetch,
  isRoomEligibleForRawFetch,
  resolvePrefetchConfig,
  resolveRoomPrefetchTier,
  ROOM_TAIL_PREFETCH_DEPTH,
  sanitizePrefetchDepth,
  sanitizePrefetchScope,
} from '../prefetchPolicy';
import { StateEvent } from '../../../../types/matrix/room';

const makeCreateEvent = (senderId: string | undefined): MatrixEvent =>
  ({
    getSender: () => senderId,
  } as unknown as MatrixEvent);

const makeRoom = (
  createSender: string | undefined | 'missing',
  encrypted = false,
  roomId = '!room:mindroom.chat'
): Room => {
  const stateEvent = createSender === 'missing' ? undefined : makeCreateEvent(createSender);
  return {
    roomId,
    hasEncryptionStateEvent: () => encrypted,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: StateEvent, _stateKey: string) => {
          if (eventType !== StateEvent.RoomCreate) return undefined;
          return stateEvent;
        },
      }),
    }),
  } as unknown as Room;
};

const makeClient = (domain: string | undefined): MatrixClient =>
  ({
    getDomain: () => domain,
  } as unknown as MatrixClient);

describe('resolveRoomPrefetchTier (CINNY-207 P4.2 / D3)', () => {
  it('returns "own" when the create event sender is on our homeserver', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@alice:mindroom.chat');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('own');
  });

  it('returns "federated" when the create event sender is on a different homeserver', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@bob:example.org');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('federated');
  });

  it('tolerates ports in the homeserver domain', () => {
    const mx = makeClient('example.test:8443');
    const room = makeRoom('@alice:example.test:8443');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('own');
  });

  it('returns "background" when the create event is missing (no room-state parse of the id)', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('missing');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('background');
  });

  it('returns "federated" when the sender id is malformed (no colon)', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('malformed');
    // No colon -> senderDomain is undefined -> tier is background, not
    // federated. Guard against future misclassification.
    expect(resolveRoomPrefetchTier(mx, room)).toBe('background');
  });

  it('returns "federated" when our homeserver domain is unknown', () => {
    const mx = makeClient(undefined);
    const room = makeRoom('@alice:example.org');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('federated');
  });
});

describe('isRoomEligibleForRawFetch', () => {
  it('accepts an own-server unencrypted room', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@alice:mindroom.chat', false);
    expect(isRoomEligibleForRawFetch(mx, room)).toBe(true);
  });

  it('accepts encrypted history for awaited SDK decryption', () => {
    expect(
      isRoomEligibleForRawFetch(makeClient('mindroom.chat'), makeRoom('@alice:mindroom.chat', true))
    ).toBe(true);
  });

  it('rejects a federated room even if unencrypted', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@bob:example.org', false);
    expect(isRoomEligibleForRawFetch(mx, room)).toBe(false);
  });

  it('rejects a background room (create event unknown)', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('missing');
    expect(isRoomEligibleForRawFetch(mx, room)).toBe(false);
  });
});

describe('sanitizePrefetchScope (CINNY-207 P6.1 / D4)', () => {
  it('accepts every whitelisted literal', () => {
    expect(sanitizePrefetchScope('my-server')).toBe('my-server');
    expect(sanitizePrefetchScope('all-rooms')).toBe('all-rooms');
    expect(sanitizePrefetchScope('current-room-only')).toBe('current-room-only');
  });

  it('coerces unknown scopes to the default', () => {
    expect(sanitizePrefetchScope('other')).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope('MY-SERVER')).toBe(DEFAULT_PREFETCH_SCOPE); // case sensitive
    expect(sanitizePrefetchScope('')).toBe(DEFAULT_PREFETCH_SCOPE);
  });

  it('coerces non-string values to the default', () => {
    expect(sanitizePrefetchScope(undefined)).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope(null)).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope(1)).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope({ scope: 'my-server' })).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope([])).toBe(DEFAULT_PREFETCH_SCOPE);
  });
});

describe('sanitizePrefetchDepth (CINNY-207 P6.1 / D4)', () => {
  it('returns the default for non-numeric or infinite inputs', () => {
    expect(sanitizePrefetchDepth(undefined)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(null)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth('500')).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(Number.NaN)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(Number.POSITIVE_INFINITY)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(Number.NEGATIVE_INFINITY)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
  });

  it('clamps to the [ROOM_TAIL_PREFETCH_DEPTH, CURRENT_ROOM_DEEP_HISTORY_TARGET] range', () => {
    expect(sanitizePrefetchDepth(0)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(15)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(ROOM_TAIL_PREFETCH_DEPTH - 1)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(-500)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(99999)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(CURRENT_ROOM_DEEP_HISTORY_TARGET + 1)).toBe(
      CURRENT_ROOM_DEEP_HISTORY_TARGET
    );
  });

  it('truncates non-integer inputs before clamping', () => {
    expect(sanitizePrefetchDepth(500.9)).toBe(500);
    expect(sanitizePrefetchDepth(2500.4)).toBe(2500);
  });

  it('passes valid mid-range integers through unchanged', () => {
    expect(sanitizePrefetchDepth(ROOM_TAIL_PREFETCH_DEPTH)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(1000)).toBe(1000);
    expect(sanitizePrefetchDepth(CURRENT_ROOM_DEEP_HISTORY_TARGET)).toBe(
      CURRENT_ROOM_DEEP_HISTORY_TARGET
    );
  });
});

describe('resolvePrefetchConfig (CINNY-207 P6.1 / D4)', () => {
  it('builds a valid config from an empty settings snapshot', () => {
    expect(resolvePrefetchConfig({})).toEqual({
      scope: DEFAULT_PREFETCH_SCOPE,
    });
  });

  it('threads sanitized user values through', () => {
    expect(resolvePrefetchConfig({ prefetchScope: 'current-room-only' })).toEqual({
      scope: 'current-room-only',
    });
  });

  it('coerces garbage inputs via the underlying sanitizers', () => {
    expect(resolvePrefetchConfig({ prefetchScope: 'nope' })).toEqual({
      scope: DEFAULT_PREFETCH_SCOPE,
    });
  });
});

// CINNY-207 P7.2 audit finding #5: unit coverage for the new
// scope-aware background prefetch gate. The gap-fill executor consults
// this helper on every runOnce; each PrefetchScope literal must
// produce a distinct eligibility decision or the setting is a no-op.
describe('isRoomEligibleForBackgroundPrefetch (CINNY-207 P7.2)', () => {
  const mx = makeClient('mindroom.chat');
  const ownRoom = makeRoom('@alice:mindroom.chat', false, '!own:mindroom.chat');
  const federatedRoom = makeRoom('@bob:example.org', false, '!fed:example.org');
  const encryptedOwn = makeRoom('@alice:mindroom.chat', true, '!enc:mindroom.chat');

  it('my-server: admits own-tier, rejects federated, admits encrypted', () => {
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: ownRoom,
        scope: 'my-server',
        focusedRoomId: undefined,
      })
    ).toBe(true);
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: federatedRoom,
        scope: 'my-server',
        focusedRoomId: undefined,
      })
    ).toBe(false);
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: encryptedOwn,
        scope: 'my-server',
        focusedRoomId: undefined,
      })
    ).toBe(true);
  });

  it('all-rooms: admits own-tier AND federated, admits encrypted', () => {
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: ownRoom,
        scope: 'all-rooms',
        focusedRoomId: undefined,
      })
    ).toBe(true);
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: federatedRoom,
        scope: 'all-rooms',
        focusedRoomId: undefined,
      })
    ).toBe(true);
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: encryptedOwn,
        scope: 'all-rooms',
        focusedRoomId: undefined,
      })
    ).toBe(true);
  });

  it('current-room-only: admits ONLY the focused room, rejects otherwise', () => {
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: ownRoom,
        scope: 'current-room-only',
        focusedRoomId: '!own:mindroom.chat',
      })
    ).toBe(true);
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: ownRoom,
        scope: 'current-room-only',
        focusedRoomId: '!different:mindroom.chat',
      })
    ).toBe(false);
    expect(
      isRoomEligibleForBackgroundPrefetch({
        mx,
        room: ownRoom,
        scope: 'current-room-only',
        focusedRoomId: undefined,
      })
    ).toBe(false);
  });
});
