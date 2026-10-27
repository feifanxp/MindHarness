import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../types/matrix/room';
import { agentCallState, ALICE, fakeRoom, HELPER } from '../../test-utils/agentCallRoom';
import {
  cleanupMindroomAgentCall,
  clearAgentCallOrigin,
  createAgentVoiceRoom,
  findAgentCallRoom,
  hasMindroomVoiceCallsPresence,
  prepareAgentCallRoom,
  toAgentCallOrigin,
} from './agentCall';

const setRoomArchived = vi.hoisted(() => vi.fn());
vi.mock('../rooms/archivedRooms', () => ({ setRoomArchived }));

const createRoom = vi.fn();
const addPushRule = vi.fn();
const kick = vi.fn();
const leave = vi.fn();
const forget = vi.fn();
const sendStateEvent = vi.fn();
let rooms: ReturnType<typeof fakeRoom>[] = [];

const mx = {
  createRoom,
  addPushRule,
  getRooms: () => rooms,
  getSafeUserId: () => ALICE,
  getUserId: () => ALICE,
  kick,
  leave,
  forget,
  sendStateEvent,
} as any;

const ephemeralRoom = (creatorUserId = ALICE, eventSender = ALICE) =>
  fakeRoom({
    call: agentCallState({ creator_user_id: creatorUserId, ephemeral: true }),
    callSender: eventSender,
  });

const origin = { room_id: '!room:mindroom.test', thread_id: '$root' };

describe('MindRoom agent calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rooms = [];
    createRoom.mockResolvedValue({ room_id: '!call:mindroom.test' });
    addPushRule.mockResolvedValue({});
    // Archiving waits for its sync echo, which never arrives here; the room must not wait for it.
    setRoomArchived.mockReturnValue(new Promise(() => {}));
    kick.mockResolvedValue({});
    leave.mockResolvedValue({});
    forget.mockResolvedValue({});
    sendStateEvent.mockResolvedValue({});
  });

  it('creates a private encrypted, muted, archived voice room tagged as a permanent call with one agent', async () => {
    await expect(
      createAgentVoiceRoom(mx, '@mindroom_helper:mindroom.test', 'Helper', true)
    ).resolves.toBe('!call:mindroom.test');

    expect(createRoom).toHaveBeenCalledWith({
      name: 'Call with Helper',
      invite: ['@mindroom_helper:mindroom.test'],
      visibility: 'private',
      preset: 'private_chat',
      creation_content: { type: 'org.matrix.msc3417.call' },
      power_level_content_override: {
        events: {
          'm.room.power_levels': 100,
          'm.room.server_acl': 100,
          'm.room.encryption': 100,
          'm.room.history_visibility': 100,
          'm.room.tombstone': 100,
          'org.matrix.msc3401.call.member': 0,
          'io.mindroom.background_jobs': 0,
        },
      },
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
        { type: 'org.matrix.msc3401.call', state_key: '', content: {} },
        {
          type: StateEvent.MindroomAgentCall,
          state_key: '',
          content: {
            version: 1,
            agent_user_id: '@mindroom_helper:mindroom.test',
            creator_user_id: '@alice:mindroom.test',
            ephemeral: false,
          },
        },
      ],
    });
    expect(addPushRule).toHaveBeenCalledWith('global', 'override', '!call:mindroom.test', {
      conditions: [{ kind: 'event_match', key: 'room_id', pattern: '!call:mindroom.test' }],
      actions: [],
    });
    expect(setRoomArchived).toHaveBeenCalledWith(mx, '!call:mindroom.test', true);
  });

  it('still returns the new room when muting and archiving it fail', async () => {
    addPushRule.mockRejectedValueOnce(new Error('push rules unavailable'));
    setRoomArchived.mockRejectedValueOnce(new Error('account data unavailable'));

    await expect(createAgentVoiceRoom(mx, HELPER, 'Helper', true)).resolves.toBe(
      '!call:mindroom.test'
    );
  });

  it.each([
    ['$root', '$root'],
    [undefined, null],
    ['~!room:mindroom.test:m1791165951526.3', null],
  ])('builds an origin from thread %s with thread id %s', (threadId, expected) => {
    expect(toAgentCallOrigin('!room:mindroom.test', threadId)).toEqual({
      room_id: '!room:mindroom.test',
      thread_id: expected,
    });
  });

  it('creates an unencrypted room when client policy disables encryption', async () => {
    await createAgentVoiceRoom(mx, '@mindroom_helper:mindroom.test', undefined, false);

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Call with mindroom_helper',
        initial_state: [
          { type: 'org.matrix.msc3401.call', state_key: '', content: {} },
          expect.objectContaining({ type: StateEvent.MindroomAgentCall }),
        ],
      })
    );
  });

  it('requires the exact voice-call presence capability', () => {
    expect(hasMindroomVoiceCallsPresence('🤖 Model: openai/gpt-5.5 | 📞 Voice calls')).toBe(true);
    expect(hasMindroomVoiceCallsPresence('💼 Discusses voice calls')).toBe(false);
    expect(hasMindroomVoiceCallsPresence(undefined)).toBe(false);
  });

  it('finds my permanent call room with the agent', () => {
    const callRoom = fakeRoom({ call: agentCallState() });
    rooms = [fakeRoom({ roomId: '!plain:mindroom.test', callRoom: false }), callRoom];

    expect(findAgentCallRoom(mx, HELPER)).toBe(callRoom);
  });

  it.each([
    [
      'created by someone else',
      { call: agentCallState({ creator_user_id: '@bob:mindroom.test' }) },
    ],
    [
      'with another agent',
      { call: agentCallState({ agent_user_id: '@mindroom_other:mindroom.test' }) },
    ],
    ['that is ephemeral', { call: agentCallState({ ephemeral: true }) }],
    ['stamped by another sender', { call: agentCallState(), callSender: '@mallory:mindroom.test' }],
    ['that I have left', { call: agentCallState(), membership: 'leave' }],
    ['without the call room type', { call: agentCallState(), callRoom: false }],
    ['with another state version', { call: agentCallState({ version: 2 }) }],
  ])('ignores a call room %s', (_case, options) => {
    rooms = [fakeRoom(options)];

    expect(findAgentCallRoom(mx, HELPER)).toBeUndefined();
  });

  it('picks the oldest of duplicate call rooms, then the lowest room id', () => {
    const room = (roomId: string, createdTs: number) =>
      fakeRoom({ roomId, createdTs, call: agentCallState() });
    rooms = [room('!c:mindroom.test', 2), room('!b:mindroom.test', 1), room('!a:mindroom.test', 1)];

    expect(findAgentCallRoom(mx, HELPER)?.roomId).toBe('!a:mindroom.test');
  });

  it('kicks the agent, leaves, and forgets a creator-owned ephemeral room', async () => {
    await cleanupMindroomAgentCall(mx, ephemeralRoom());

    expect(kick).toHaveBeenCalledWith(
      '!call:mindroom.test',
      '@mindroom_helper:mindroom.test',
      'MindRoom agent call ended'
    );
    expect(leave).toHaveBeenCalledWith('!call:mindroom.test');
    expect(forget).toHaveBeenCalledWith('!call:mindroom.test');
  });

  it('does not try to forget a room when leaving fails', async () => {
    leave.mockRejectedValueOnce(new Error('leave failed'));

    await cleanupMindroomAgentCall(mx, ephemeralRoom());

    expect(forget).not.toHaveBeenCalled();
  });

  it('does not clean up a room created by someone else', async () => {
    await cleanupMindroomAgentCall(mx, ephemeralRoom('@bob:mindroom.test'));

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it('does not trust forged creator metadata from another event sender', async () => {
    await cleanupMindroomAgentCall(
      mx,
      ephemeralRoom('@alice:mindroom.test', '@mallory:mindroom.test')
    );

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it('lets the agent publish its background jobs in a call room made before it could', async () => {
    // The room's own levels stay as they are; only the jobs event is added.
    const powerLevels = {
      users: { [ALICE]: 100 },
      events: { 'org.matrix.msc3401.call.member': 50 },
    };
    const room = fakeRoom({ call: agentCallState(), agentMembership: 'join', powerLevels });
    await prepareAgentCallRoom(mx, room, HELPER, origin);
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!call:mindroom.test',
      StateEvent.RoomPowerLevels,
      {
        users: { [ALICE]: 100 },
        events: { 'org.matrix.msc3401.call.member': 50, 'io.mindroom.background_jobs': 0 },
      },
      ''
    );
  });

  it('starts the call only once an older call room lets the agent publish its jobs', async () => {
    let land: () => void = () => undefined;
    sendStateEvent.mockImplementation((_roomId: string, type: string) =>
      type === StateEvent.RoomPowerLevels
        ? new Promise((resolve) => {
            land = () => resolve({});
          })
        : Promise.resolve({})
    );
    const powerLevels = { events: { 'org.matrix.msc3401.call.member': 0 } };
    const room = fakeRoom({ call: agentCallState(), agentMembership: 'join', powerLevels });
    let prepared = false;
    const preparing = prepareAgentCallRoom(mx, room, HELPER, origin).then(() => {
      prepared = true;
    });
    await vi.waitFor(() =>
      expect(sendStateEvent).toHaveBeenCalledWith(
        '!call:mindroom.test',
        StateEvent.RoomPowerLevels,
        expect.anything(),
        ''
      )
    );
    expect(prepared).toBe(false);
    land();
    await preparing;
    expect(prepared).toBe(true);
  });

  it('leaves the power levels of a call room that already allows it alone', async () => {
    const powerLevels = { events: { 'io.mindroom.background_jobs': 0 } };
    const room = fakeRoom({ call: agentCallState(), agentMembership: 'join', powerLevels });
    await prepareAgentCallRoom(mx, room, HELPER, origin);
    expect(sendStateEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      StateEvent.RoomPowerLevels,
      expect.anything(),
      expect.anything()
    );
  });

  it('keeps a permanent call room on hang-up and drops its origin before the stamp synced back', async () => {
    // The stamp landed on the server, but the room's cached state does not show its origin yet.
    const room = fakeRoom({ call: agentCallState(), agentMembership: 'join' });
    await prepareAgentCallRoom(mx, room, HELPER, origin);
    await cleanupMindroomAgentCall(mx, room);

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(sendStateEvent).toHaveBeenLastCalledWith(
        '!call:mindroom.test',
        StateEvent.MindroomAgentCall,
        agentCallState(),
        ''
      )
    );
  });

  describe('ordering state writes', () => {
    const settle = () =>
      new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    let serverState: unknown;
    let pending: { content: unknown; land: () => void; fail: (error: Error) => void }[];

    beforeEach(() => {
      serverState = undefined;
      pending = [];
      // Each request lands on the server only when the test lets it, like independent HTTP writes.
      sendStateEvent.mockImplementation(
        (_roomId: string, _type: string, content: unknown) =>
          new Promise((resolve, reject) => {
            pending.push({
              content,
              land: () => {
                serverState = content;
                resolve({});
              },
              fail: reject,
            });
          })
      );
    });

    const prepare = () =>
      prepareAgentCallRoom(mx, fakeRoom({ agentMembership: 'join' }), HELPER, origin);

    it('sends a new call stamp only after an earlier origin clear settled', async () => {
      clearAgentCallOrigin(mx, '!call:mindroom.test', HELPER);
      const prepared = prepare();
      await settle();

      expect(pending).toHaveLength(1);
      pending[0].land();
      await settle();
      expect(pending).toHaveLength(2);
      pending[1].land();
      await prepared;

      expect(serverState).toEqual(agentCallState({ origin }));
    });

    it('still stamps the new call when the earlier clear failed', async () => {
      clearAgentCallOrigin(mx, '!call:mindroom.test', HELPER);
      const prepared = prepare();
      await settle();

      pending[0].fail(new Error('clear failed'));
      await settle();
      pending[1].land();
      await prepared;

      expect(serverState).toEqual(agentCallState({ origin }));
    });
  });
});
