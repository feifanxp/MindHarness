import { ICreateRoomStateEvent, MatrixClient, Preset, Room, Visibility } from 'matrix-js-sdk';
import { Membership, RoomType, StateEvent } from '../../../types/matrix/room';
import {
  createRoomCallState,
  createRoomEncryptionState,
  createVoiceRoomPowerLevelsOverride,
} from '../../components/create-room/utils';
import {
  RoomNotificationMode,
  setRoomNotificationPreference,
} from '../../hooks/useRoomsNotificationPreferences';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getStateEvent } from '../../utils/room';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from '../background-jobs/backgroundJobsContract';
import { setRoomArchived } from '../rooms/archivedRooms';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';

export const MINDROOM_VOICE_CALLS_PRESENCE = '📞 Voice calls';

export const hasMindroomVoiceCallsPresence = (status: string | undefined): boolean =>
  status?.split(' | ').includes(MINDROOM_VOICE_CALLS_PRESENCE) ?? false;

export type MindroomAgentCallOrigin = { room_id: string; thread_id: string | null };

/** A new thread's root is a local echo until it is sent; the backend can only resolve a real event. */
export const toAgentCallOrigin = (
  roomId: string,
  threadId: string | undefined
): MindroomAgentCallOrigin => ({
  room_id: roomId,
  thread_id: isConfirmedMatrixEventId(threadId) ? threadId : null,
});

export type MindroomAgentCallContent = {
  version: 1;
  agent_user_id: string;
  creator_user_id: string;
  /** Legacy throwaway rooms are `true`; the permanent per-caller rooms are `false`. */
  ephemeral: boolean;
  origin?: MindroomAgentCallOrigin;
};

const agentCallContent = (
  mx: MatrixClient,
  agentUserId: string,
  origin?: MindroomAgentCallOrigin
): MindroomAgentCallContent => ({
  version: 1,
  agent_user_id: agentUserId,
  creator_user_id: mx.getSafeUserId(),
  ephemeral: false,
  ...(origin && { origin }),
});

const writeTails = new WeakMap<MatrixClient, Map<string, Promise<unknown>>>();

/** The SDK sends state writes independently, so an earlier clear could land after a newer stamp. */
const sendAgentCall = (
  mx: MatrixClient,
  roomId: string,
  agentUserId: string,
  origin?: MindroomAgentCallOrigin
) => {
  const tails = writeTails.get(mx) ?? new Map<string, Promise<unknown>>();
  writeTails.set(mx, tails);
  const write = (tails.get(roomId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      mx.sendStateEvent(
        roomId,
        StateEvent.MindroomAgentCall as any,
        agentCallContent(mx, agentUserId, origin),
        ''
      )
    );
  tails.set(roomId, write);
  return write;
};

/** A later join without a fresh stamp, such as the call room's own Join, must not reuse an old thread. */
export const clearAgentCallOrigin = (mx: MatrixClient, roomId: string, agentUserId: string) => {
  sendAgentCall(mx, roomId, agentUserId).catch(() => undefined);
};

/** The agent call state of a room, when I created the room and wrote that state myself. */
const getOwnAgentCall = (mx: MatrixClient, room: Room): MindroomAgentCallContent | undefined => {
  const event = getStateEvent(room, StateEvent.MindroomAgentCall);
  const content = event?.getContent();
  const userId = mx.getUserId();
  return content?.version === 1 &&
    typeof content.agent_user_id === 'string' &&
    event?.getSender() === userId &&
    content.creator_user_id === userId
    ? (content as MindroomAgentCallContent)
    : undefined;
};

// The agent may publish its background jobs, as in the rooms MindRoom creates, so the call chat shows them.
const AGENT_JOBS_EVENT_LEVEL = { [MINDROOM_BACKGROUND_JOBS_EVENT]: 0 };

const createdAt = (room: Room): number => getStateEvent(room, StateEvent.RoomCreate)?.getTs() ?? 0;

/** My permanent call room with this agent; two devices racing on the first call agree on the oldest. */
export const findAgentCallRoom = (mx: MatrixClient, agentUserId: string): Room | undefined =>
  mx
    .getRooms()
    .filter((room) => {
      if (room.getMyMembership() !== Membership.Join || !room.isCallRoom()) return false;
      const call = getOwnAgentCall(mx, room);
      return call?.ephemeral === false && call.agent_user_id === agentUserId;
    })
    .sort((a, b) => createdAt(a) - createdAt(b) || (a.roomId < b.roomId ? -1 : 1))[0];

export const createAgentVoiceRoom = async (
  mx: MatrixClient,
  agentUserId: string,
  displayName: string | undefined,
  encrypted: boolean
): Promise<string> => {
  const initialState: ICreateRoomStateEvent[] = [
    createRoomCallState(),
    {
      type: StateEvent.MindroomAgentCall,
      state_key: '',
      content: agentCallContent(mx, agentUserId),
    },
  ];
  if (encrypted) initialState.unshift(createRoomEncryptionState());
  const voiceLevels = createVoiceRoomPowerLevelsOverride();

  const result = await mx.createRoom({
    name: `Call with ${displayName ?? getMxIdLocalPart(agentUserId) ?? agentUserId}`,
    invite: [agentUserId],
    visibility: Visibility.Private,
    preset: Preset.PrivateChat,
    creation_content: {
      type: RoomType.Call,
    },
    power_level_content_override: {
      ...voiceLevels,
      events: { ...voiceLevels.events, ...AGENT_JOBS_EVENT_LEVEL },
    },
    initial_state: initialState,
  });
  // Calls open the room from the call bar, so it is archived out of navigation, and muted so its
  // side-chat messages raise no notifications nobody can find. Archiving waits for its sync echo.
  setRoomArchived(mx, result.room_id, true).catch(() => undefined);
  await setRoomNotificationPreference(
    mx,
    result.room_id,
    RoomNotificationMode.Mute,
    RoomNotificationMode.Unset
  ).catch(() => undefined);

  return result.room_id;
};

/**
 * Re-invites an agent that left and overwrites the previous call's origin.
 * The backend reads this state when the agent joins the call, so it must be written before the call starts.
 */
export const prepareAgentCallRoom = async (
  mx: MatrixClient,
  room: Room,
  agentUserId: string,
  origin: MindroomAgentCallOrigin
): Promise<void> => {
  // Members are lazy-loaded; inviting an agent that is already joined would fail.
  await room.loadMembersIfNeeded();
  const membership = room.getMember(agentUserId)?.membership;
  if (membership !== Membership.Join && membership !== Membership.Invite) {
    await mx.invite(room.roomId, agentUserId);
  }
  // A call room made before agents could publish their background jobs gains that power level before the
  // agent hears of the call, so its first jobs are not refused; best effort.
  const powerLevels = getStateEvent(room, StateEvent.RoomPowerLevels)?.getContent();
  if (powerLevels && powerLevels.events?.[MINDROOM_BACKGROUND_JOBS_EVENT] === undefined) {
    await mx
      .sendStateEvent(
        room.roomId,
        StateEvent.RoomPowerLevels as never,
        {
          ...powerLevels,
          events: { ...powerLevels.events, ...AGENT_JOBS_EVENT_LEVEL },
        } as never,
        ''
      )
      .catch(() => undefined);
  }
  await sendAgentCall(mx, room.roomId, agentUserId, origin);
};

export const cleanupMindroomAgentCall = async (mx: MatrixClient, room: Room): Promise<void> => {
  const call = getOwnAgentCall(mx, room);
  // Permanent call rooms stay for the next call, minus this call's origin; legacy rooms are torn down.
  // The cached state may not show this call's origin yet, so the clear is always sent.
  if (call?.ephemeral === false) clearAgentCallOrigin(mx, room.roomId, call.agent_user_id);
  if (call?.ephemeral !== true) return;

  const { roomId } = room;
  try {
    await mx.kick(roomId, call.agent_user_id, 'MindRoom agent call ended');
  } catch {
    // The agent may not have joined yet or may already have left.
  }

  try {
    await mx.leave(roomId);
    try {
      await mx.forget(roomId);
    } catch {
      // Leaving is the important cleanup; forgetting can be retried by the SDK/UI later.
    }
  } catch {
    // A failed leave remains visible and can be retried from the room menu.
  }
};
