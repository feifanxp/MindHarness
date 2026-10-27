import { describe, expect, it } from 'vitest';
import {
  canRenderRoutedRoom,
  isJoinedRoom,
  resolveSpaceRouteRoomAccess,
  shouldDeferRoomRouteFallback,
  shouldDeferSpaceRoomRouteFallback,
} from './routeVisibility';
import { Membership } from '../../../types/matrix/room';

const makeRoom = (
  {
    roomId = '!room:example.org',
    membership = Membership.Join,
    isSpaceRoom = false,
  }: {
    roomId?: string;
    membership?: Membership;
    isSpaceRoom?: boolean;
  } = {}
) =>
  ({
    roomId,
    getMyMembership: () => membership,
    isSpaceRoom: () => isSpaceRoom,
  }) as const;

describe('routeVisibility', () => {
  it('treats SDK-joined rooms as renderable even before route lists catch up', () => {
    expect(canRenderRoutedRoom(makeRoom({ membership: Membership.Join }), [])).toBe(true);
  });

  it('does not treat invited rooms as renderable without route membership', () => {
    expect(canRenderRoutedRoom(makeRoom({ membership: Membership.Invite }), [])).toBe(false);
  });

  it('detects joined membership from the SDK room object', () => {
    expect(isJoinedRoom(makeRoom({ membership: Membership.Join }))).toBe(true);
    expect(isJoinedRoom(makeRoom({ membership: Membership.Leave }))).toBe(false);
    expect(isJoinedRoom(undefined)).toBe(false);
  });

  it('renders space child rooms immediately and backfills the missing parent mapping', () => {
    expect(
      resolveSpaceRouteRoomAccess({
        room: makeRoom(),
        routedRoomIds: [],
        developerTools: false,
        selectedSpaceId: '!space:example.org',
        hasMappedParent: false,
        isListedChild: true,
      })
    ).toEqual({
      canRender: true,
      shouldBackfillParent: true,
    });
  });

  it('renders developer-tool space timelines without a join fallback', () => {
    expect(
      resolveSpaceRouteRoomAccess({
        room: makeRoom({ roomId: '!space:example.org', isSpaceRoom: true }),
        routedRoomIds: [],
        developerTools: true,
        selectedSpaceId: '!space:example.org',
        hasMappedParent: false,
        isListedChild: false,
      })
    ).toEqual({
      canRender: true,
      shouldBackfillParent: false,
    });
  });

  it('still blocks unrelated joined rooms that are not part of the selected space', () => {
    expect(
      resolveSpaceRouteRoomAccess({
        room: makeRoom(),
        routedRoomIds: [],
        developerTools: false,
        selectedSpaceId: '!space:example.org',
        hasMappedParent: false,
        isListedChild: false,
      })
    ).toEqual({
      canRender: false,
      shouldBackfillParent: false,
    });
  });

  it('defers room fallbacks until initial sync has completed', () => {
    expect(
      shouldDeferRoomRouteFallback({
        hasCompletedInitialSync: false,
        isResolvingAlias: false,
        room: undefined,
        routedRoomIds: [],
      })
    ).toBe(true);

    expect(
      shouldDeferRoomRouteFallback({
        hasCompletedInitialSync: true,
        isResolvingAlias: false,
        room: undefined,
        routedRoomIds: [],
      })
    ).toBe(false);
  });

  it('defers space-room fallbacks until initial sync has completed', () => {
    expect(
      shouldDeferSpaceRoomRouteFallback({
        hasCompletedInitialSync: false,
        isResolvingAlias: false,
        access: {
          canRender: false,
          shouldBackfillParent: false,
        },
      })
    ).toBe(true);

    expect(
      shouldDeferSpaceRoomRouteFallback({
        hasCompletedInitialSync: true,
        isResolvingAlias: false,
        access: {
          canRender: false,
          shouldBackfillParent: false,
        },
      })
    ).toBe(false);
  });
});
