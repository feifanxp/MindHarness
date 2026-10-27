import { Room } from 'matrix-js-sdk';
import { RoomType, StateEvent } from '../../types/matrix/room';

export const ALICE = '@alice:mindroom.test';
export const HELPER = '@mindroom_helper:mindroom.test';

export const agentCallState = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  agent_user_id: HELPER,
  creator_user_id: ALICE,
  ephemeral: false,
  ...overrides,
});

type FakeRoomOptions = {
  roomId?: string;
  /** `io.mindroom.agent_call` content; omit for rooms that are not agent calls. */
  call?: Record<string, unknown>;
  callSender?: string;
  callRoom?: boolean;
  createdTs?: number;
  membership?: string;
  /** Only visible after `loadMembersIfNeeded`, like a lazy-loaded member list. */
  agentMembership?: string;
  /** `m.room.power_levels` content. */
  powerLevels?: Record<string, unknown>;
};

/** Just enough of a Room for the agent call helpers. */
export const fakeRoom = ({
  roomId = '!call:mindroom.test',
  call,
  callSender = ALICE,
  callRoom = true,
  createdTs = 0,
  membership = 'join',
  agentMembership,
  powerLevels,
}: FakeRoomOptions = {}): Room => {
  const state: Record<string, object> = {
    [StateEvent.RoomCreate]: {
      getContent: () => ({ type: callRoom ? RoomType.Call : undefined }),
      getTs: () => createdTs,
    },
  };
  if (call) {
    state[StateEvent.MindroomAgentCall] = { getSender: () => callSender, getContent: () => call };
  }
  if (powerLevels) state[StateEvent.RoomPowerLevels] = { getContent: () => powerLevels };
  let membersLoaded = false;
  return {
    roomId,
    getMyMembership: () => membership,
    isCallRoom: () => callRoom,
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: (eventType: string) => state[eventType] }),
    }),
    loadMembersIfNeeded: async () => {
      membersLoaded = true;
      return true;
    },
    getMember: (userId: string) =>
      membersLoaded && userId === HELPER && agentMembership
        ? { membership: agentMembership }
        : null,
  } as unknown as Room;
};
