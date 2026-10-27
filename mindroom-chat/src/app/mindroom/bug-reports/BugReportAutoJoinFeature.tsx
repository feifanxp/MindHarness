import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { JoinRule } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Membership, StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { getMxIdServer } from '../../utils/matrix';
import { getStateEvent } from '../../utils/room';
import { useBugReportAdmins } from './bugReportConfig';
import { BUG_REPORTS_ROOM_TYPE } from './bugReportRoom';

/**
 * Admins join report rooms without accepting invites. The invite's stripped state must show
 * an invite-only report room that the inviter created, on the admin's own homeserver.
 */
export const shouldAutoJoinBugReportInvite = (
  mx: MatrixClient,
  room: Room | null,
  admins: string[]
): boolean => {
  const myUserId = mx.getUserId();
  if (!room || !myUserId || !admins.includes(myUserId)) return false;
  if (room.getMyMembership() !== Membership.Invite) return false;
  const create = getStateEvent(room, StateEvent.RoomCreate);
  if (create?.getContent().type !== BUG_REPORTS_ROOM_TYPE) return false;
  if (getStateEvent(room, StateEvent.RoomJoinRules)?.getContent().join_rule !== JoinRule.Invite) {
    return false;
  }
  const inviter = room.getMember(myUserId)?.events.member?.getSender();
  return (
    !!inviter &&
    create.getSender() === inviter &&
    getMxIdServer(inviter) === getMxIdServer(myUserId)
  );
};

export function BugReportAutoJoinFeature() {
  const mx = useMatrixClient();
  const invites = useAtomValue(allInvitesAtom);
  const admins = useBugReportAdmins();
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    invites.forEach((roomId) => {
      if (attempted.current.has(roomId)) return;
      if (!shouldAutoJoinBugReportInvite(mx, mx.getRoom(roomId), admins)) return;
      attempted.current.add(roomId);
      mx.joinRoom(roomId).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[bug-report] could not auto-join report room', roomId, error);
      });
    });
  }, [mx, invites, admins]);

  return null;
}
