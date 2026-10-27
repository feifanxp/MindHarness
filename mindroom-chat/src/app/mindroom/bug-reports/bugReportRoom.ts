import { HistoryVisibility, JoinRule, Preset, Visibility } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Membership } from '../../../types/matrix/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { waitForJoinedRoom } from '../matrix/waitForJoinedRoom';

export const BUG_REPORTS_ROOM_TYPE = 'io.mindroom.bug_reports';
const BUG_REPORTS_ACCOUNT_DATA_TYPE = 'io.mindroom.bug_reports';

const inFlight = new WeakMap<MatrixClient, Promise<Room>>();

export const getReporterName = (mx: MatrixClient, userId: string): string =>
  mx.getUser(userId)?.displayName ?? getMxIdLocalPart(userId) ?? userId;

const isJoinedOrInvited = (membership: string | undefined): boolean =>
  membership === Membership.Join || membership === Membership.Invite;

const getStoredRoomId = (mx: MatrixClient): string | undefined => {
  const content = mx
    .getAccountData(BUG_REPORTS_ACCOUNT_DATA_TYPE as never)
    ?.getContent<{ room_id?: unknown }>();
  return typeof content?.room_id === 'string' ? content.room_id : undefined;
};

/** A report room is typed, invite-only, and visible only to the reporter and the current admins. */
const isReusableReportRoom = (room: Room, myUserId: string, admins: string[]): boolean =>
  room.getType() === BUG_REPORTS_ROOM_TYPE &&
  room.getJoinRule() === JoinRule.Invite &&
  room.getHistoryVisibility() !== HistoryVisibility.WorldReadable &&
  room
    .getMembers()
    .every(
      (member) =>
        member.userId === myUserId ||
        !isJoinedOrInvited(member.membership) ||
        admins.includes(member.userId)
    );

/** The stored room, if the reporter is still in it and it is still a private report room. */
const findReusableRoom = async (
  mx: MatrixClient,
  myUserId: string,
  admins: string[]
): Promise<Room | undefined> => {
  const storedRoomId = getStoredRoomId(mx);
  const stored = storedRoomId ? mx.getRoom(storedRoomId) : null;
  if (!stored || stored.getMyMembership() !== Membership.Join) return undefined;
  // The sync lazy-loads members, so admins who never spoke may be missing until loaded.
  await stored.loadMembersIfNeeded();
  return isReusableReportRoom(stored, myUserId, admins) ? stored : undefined;
};

/**
 * Invites admins who are neither joined nor invited. A failed invite only fails the
 * report when no admin at all could receive it.
 */
const inviteMissingAdmins = async (mx: MatrixClient, room: Room, admins: string[]) => {
  const missing = admins.filter((userId) => !isJoinedOrInvited(room.getMember(userId)?.membership));
  const results = await Promise.allSettled(missing.map((userId) => mx.invite(room.roomId, userId)));
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    failed += 1;
    // eslint-disable-next-line no-console
    console.warn('[bug-report] could not invite a report admin', missing[index], result.reason);
  });
  if (admins.length > 0 && failed === admins.length) {
    throw new Error('No bug report admin could be invited to the report room.');
  }
};

const createReportRoom = async (mx: MatrixClient, myUserId: string, admins: string[]) => {
  // No m.room.encryption: matrix-mcp, which coding agents use to read reports, has no E2EE.
  const { room_id: roomId } = await mx.createRoom({
    name: `Bug reports · ${getReporterName(mx, myUserId)}`,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    invite: admins,
    creation_content: { type: BUG_REPORTS_ROOM_TYPE },
  });
  await mx.setAccountData(BUG_REPORTS_ACCOUNT_DATA_TYPE as never, { room_id: roomId } as never);
  const room = await waitForJoinedRoom(mx, roomId);
  // Tuwunel creates the room even when an invite fails, so check who was really invited.
  await room.loadMembersIfNeeded();
  return room;
};

/**
 * The reporter's private room with the administrators, created on first use and
 * replaced (never kicked or left) when it is no longer private to the current admins.
 */
export const ensureBugReportRoom = (mx: MatrixClient, admins: string[]): Promise<Room> => {
  const pending = inFlight.get(mx);
  if (pending) return pending;

  const myUserId = mx.getSafeUserId();
  const otherAdmins = admins.filter((userId) => userId !== myUserId);
  const lookup = (async () => {
    const room =
      (await findReusableRoom(mx, myUserId, otherAdmins)) ??
      (await createReportRoom(mx, myUserId, otherAdmins));
    await inviteMissingAdmins(mx, room, otherAdmins);
    return room;
  })().finally(() => inFlight.delete(mx));
  inFlight.set(mx, lookup);
  return lookup;
};
