import { useAtom, useAtomValue } from 'jotai';
import { KnownMembership, RoomMemberEvent, type MatrixClient } from 'matrix-js-sdk';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AccountDataEvent, type MDirectContent } from '../../../types/matrix/accountData';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { mDirectAtom } from '../../state/mDirectList';
import { createSessionId } from '../../state/sessions';
import { getAccountData } from '../../utils/room';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/agentIdentity';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import {
  DEFAULT_ROOM_VIEW_MODE,
  getAvailableRoomViewModes,
  isRoomViewModeAvailable,
  roomViewModeAtomFamily,
  type RoomViewMode,
} from './roomViewMode';

export const resolveEffectiveRoomViewMode = (
  storedViewMode: RoomViewMode,
  simpleMode: boolean,
  humanDirectRoom: boolean
): RoomViewMode => {
  if (humanDirectRoom) return 'classic';
  return isRoomViewModeAvailable(storedViewMode, simpleMode)
    ? storedViewMode
    : DEFAULT_ROOM_VIEW_MODE;
};

// Thread lists render a card per thread, so one client listener serves every direct room's hooks.
const membershipListeners = new WeakMap<MatrixClient, Map<string, Set<() => void>>>();

const subscribeRoomMembership = (mx: MatrixClient, roomId: string, onChange: () => void) => {
  let rooms = membershipListeners.get(mx);
  if (!rooms) {
    const created = new Map<string, Set<() => void>>();
    mx.on(RoomMemberEvent.Membership, (_event, member) => {
      created.get(member.roomId)?.forEach((listener) => listener());
    });
    membershipListeners.set(mx, created);
    rooms = created;
  }
  const listeners = rooms.get(roomId) ?? new Set();
  rooms.set(roomId, listeners);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) rooms.delete(roomId);
  };
};

/**
 * Whether a MindRoom agent is in the room: joined or invited, or named as the room's partner in `m.direct`.
 * Members are lazy loaded, so an agent direct room may not have its agent loaded yet; only a loaded `leave` or `ban` ends the partner.
 */
const hasMindroomAgent = (mx: MatrixClient, roomId: string): boolean => {
  const room = mx.getRoom(roomId);
  if (hasActiveMindroomAgent(room?.getMembers() ?? [])) return true;
  const directs = getAccountData(mx, AccountDataEvent.Direct)?.getContent<MDirectContent>() ?? {};
  return Object.entries(directs).some(([userId, roomIds]) => {
    if (!isMindroomAgentUserId(userId) || !Array.isArray(roomIds) || !roomIds.includes(roomId)) {
      return false;
    }
    const membership = room?.getMember(userId)?.membership;
    return membership !== KnownMembership.Leave && membership !== KnownMembership.Ban;
  });
};

/** A direct room (in `m.direct`) with no MindRoom agent. */
const useIsHumanDirectRoom = (roomId: string): boolean => {
  const mx = useMatrixClient();
  const direct = useAtomValue(mDirectAtom).has(roomId);
  const subscribe = useCallback(
    (onChange: () => void) =>
      direct ? subscribeRoomMembership(mx, roomId, onChange) : () => undefined,
    [direct, mx, roomId]
  );

  // `mDirectAtom` changes on every `m.direct` update, which re-reads the partners.
  return useSyncExternalStore(subscribe, () => direct && !hasMindroomAgent(mx, roomId));
};

/** One account-scoped source for persisted and effective room view modes. */
export const useRoomViewMode = (roomId: string) => {
  const mx = useMatrixClient();
  const simpleMode = useSimpleMode();
  const humanDirectRoom = useIsHumanDirectRoom(roomId);
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);
  const atom = useMemo(() => roomViewModeAtomFamily(sessionId, roomId), [roomId, sessionId]);
  const [storedViewMode, setViewMode] = useAtom(atom);
  const viewMode = resolveEffectiveRoomViewMode(storedViewMode, simpleMode, humanDirectRoom);
  const availableViewModes = getAvailableRoomViewModes(simpleMode, humanDirectRoom);

  return { availableViewModes, setViewMode, storedViewMode, viewMode };
};
