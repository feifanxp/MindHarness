import React from 'react';
import { act, create } from 'react-test-renderer';
import { getDefaultStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callEmbedAtom } from '../../state/callEmbed';
import { StateEvent } from '../../../types/matrix/room';
import { agentCallState, ALICE, fakeRoom, HELPER } from '../../test-utils/agentCallRoom';
import { MindroomAgentCallOrigin } from './agentCall';
import { useStartAgentCall } from './useStartAgentCall';

const mocks = vi.hoisted(() => ({
  requestMicrophoneAccess: vi.fn(),
  startCall: vi.fn(),
  callEmbed: undefined as unknown,
}));

vi.mock('../voice/microphoneAccess', () => ({
  requestMicrophoneAccess: mocks.requestMicrophoneAccess,
}));

const NEW_ROOM = '!new:mindroom.test';
const rooms = new Map<string, ReturnType<typeof fakeRoom>>();
const mx = {
  getUserId: () => ALICE,
  getSafeUserId: () => ALICE,
  getRooms: () => [...rooms.values()],
  getRoom: (roomId: string) => rooms.get(roomId) ?? null,
  createRoom: vi.fn(async () => {
    rooms.set(
      NEW_ROOM,
      fakeRoom({ roomId: NEW_ROOM, call: agentCallState(), agentMembership: 'invite' })
    );
    return { room_id: NEW_ROOM };
  }),
  addPushRule: vi.fn(),
  invite: vi.fn(),
  sendStateEvent: vi.fn(),
  kick: vi.fn(),
  leave: vi.fn(),
  forget: vi.fn(),
};

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({ createRoom: { defaultEncryption: true } }),
}));

vi.mock('../../hooks/useCallEmbed', () => ({
  useCallEmbed: () => mocks.callEmbed,
  useCallStart: () => mocks.startCall,
}));

vi.mock('../../hooks/useLivekitSupport', () => ({
  useLivekitSupport: () => true,
}));

vi.mock('../../utils/rtc', () => ({
  webRTCSupported: () => true,
}));

const AGENT = { userId: HELPER, displayName: 'Helper' };
const ORIGIN: MindroomAgentCallOrigin = { room_id: '!origin:mindroom.test', thread_id: '$root' };

type StartAgentCall = ReturnType<typeof useStartAgentCall>;

const renderHook = () => {
  const result = {} as { current: StartAgentCall };
  function Probe() {
    result.current = useStartAgentCall();
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe />);
  });
  return { result, renderer };
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const existingRoom = (agentMembership = 'join') => {
  const room = fakeRoom({ call: agentCallState(), agentMembership });
  rooms.set(room.roomId, room);
  return room;
};

const expectOriginCleared = (roomId: string) =>
  expect(mx.sendStateEvent).toHaveBeenLastCalledWith(
    roomId,
    StateEvent.MindroomAgentCall,
    agentCallState(),
    ''
  );

const expectNoCleanup = () => {
  expect(mx.kick).not.toHaveBeenCalled();
  expect(mx.leave).not.toHaveBeenCalled();
  expect(mx.forget).not.toHaveBeenCalled();
};

describe('useStartAgentCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rooms.clear();
    mocks.callEmbed = undefined;
    getDefaultStore().set(callEmbedAtom, undefined);
    mocks.requestMicrophoneAccess.mockResolvedValue(undefined);
    mx.addPushRule.mockResolvedValue({});
    mx.invite.mockResolvedValue({});
    mx.sendStateEvent.mockResolvedValue({});
  });

  it('reuses the call room and starts the call only after the origin is stamped', async () => {
    const room = existingRoom();
    const stamp = deferred();
    mx.sendStateEvent.mockReturnValueOnce(stamp.promise);
    const { result } = renderHook();
    let start!: Promise<boolean>;

    await act(async () => {
      start = result.current.startAgentCall(AGENT, ORIGIN);
    });
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      room.roomId,
      StateEvent.MindroomAgentCall,
      agentCallState({ origin: ORIGIN }),
      ''
    );
    expect(mocks.startCall).not.toHaveBeenCalled();
    stamp.resolve();
    let started: boolean | undefined;
    await act(async () => {
      started = await start;
    });

    expect(started).toBe(true);
    expect(mocks.requestMicrophoneAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mx.sendStateEvent.mock.invocationCallOrder[0]
    );
    expect(mx.createRoom).not.toHaveBeenCalled();
    expect(mx.invite).not.toHaveBeenCalled();
    expect(mx.sendStateEvent).toHaveBeenCalledOnce();
    expect(mocks.startCall).toHaveBeenCalledWith(room, {
      microphone: true,
      video: false,
      sound: true,
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('creates a muted call room when there is none and reuses it for the next call', async () => {
    const { result } = renderHook();

    await act(async () => {
      await result.current.startAgentCall(AGENT, ORIGIN);
    });
    await act(async () => {
      await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(mx.createRoom).toHaveBeenCalledOnce();
    expect(mx.addPushRule).toHaveBeenCalledWith('global', 'override', NEW_ROOM, expect.anything());
    expect(mx.invite).not.toHaveBeenCalled();
    expect(mocks.startCall).toHaveBeenCalledTimes(2);
    expect(mocks.startCall).toHaveBeenLastCalledWith(rooms.get(NEW_ROOM), expect.anything());
  });

  it.each([
    ['has left', 'leave', true],
    ['was never a member', undefined, true],
    ['is joined', 'join', false],
    ['is invited', 'invite', false],
  ])('invites the agent again only when it %s', async (_case, membership, invited) => {
    const room = fakeRoom({ call: agentCallState(), agentMembership: membership });
    rooms.set(room.roomId, room);
    const { result } = renderHook();

    await act(async () => {
      await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(mx.invite).toHaveBeenCalledTimes(invited ? 1 : 0);
    if (invited) expect(mx.invite).toHaveBeenCalledWith(room.roomId, HELPER);
    expect(mocks.startCall).toHaveBeenCalledOnce();
  });

  it('reports a failed origin stamp and does not start the call', async () => {
    existingRoom();
    mx.sendStateEvent.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(false);
    expect(mocks.startCall).not.toHaveBeenCalled();
    expect(result.current.error).toBe('M_FORBIDDEN');
    expect(result.current.loading).toBe(false);
    expectNoCleanup();
  });

  it('reports the error when the call fails to start and drops its origin', async () => {
    const room = existingRoom();
    mocks.startCall.mockImplementationOnce(() => {
      throw new Error('embed unavailable');
    });
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(false);
    expect(result.current.error).toBe('embed unavailable');
    expect(result.current.loading).toBe(false);
    expectOriginCleared(room.roomId);
    expectNoCleanup();
  });

  it('does not touch any room when microphone access is denied', async () => {
    mocks.requestMicrophoneAccess.mockRejectedValueOnce(new Error('Microphone access is blocked.'));
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(false);
    expect(mx.createRoom).not.toHaveBeenCalled();
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Microphone access is blocked.');
  });

  it('refuses to start while another call is embedded', async () => {
    mocks.callEmbed = {};
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(false);
    expect(result.current.unavailableReason).toBeDefined();
    expect(mocks.requestMicrophoneAccess).not.toHaveBeenCalled();
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(mocks.startCall).not.toHaveBeenCalled();
  });

  it('drops the origin and does not start a call when unmounted while the room is prepared', async () => {
    const room = existingRoom();
    const stamp = deferred();
    mx.sendStateEvent.mockReturnValueOnce(stamp.promise);
    const { result, renderer } = renderHook();
    let callPromise!: Promise<boolean>;

    await act(async () => {
      callPromise = result.current.startAgentCall(AGENT, ORIGIN);
    });
    act(() => renderer.unmount());
    stamp.resolve();
    let started: boolean | undefined;
    await act(async () => {
      started = await callPromise;
    });

    expect(started).toBe(false);
    expect(mocks.startCall).not.toHaveBeenCalled();
    expectOriginCleared(room.roomId);
    expectNoCleanup();
  });

  it('runs one start at a time and never replaces a call that started meanwhile', async () => {
    const room = existingRoom();
    const stamp = deferred();
    mx.sendStateEvent.mockReturnValueOnce(stamp.promise);
    const header = renderHook();
    const profile = renderHook();
    let headerStart!: Promise<boolean>;
    let profileStarted: boolean | undefined;

    await act(async () => {
      headerStart = header.result.current.startAgentCall(AGENT, ORIGIN);
      profileStarted = await profile.result.current.startAgentCall(AGENT, ORIGIN);
    });
    expect(profileStarted).toBe(false);
    expect(profile.result.current.loading).toBe(true);

    const incomingCall = { dispose: vi.fn() };
    act(() => getDefaultStore().set(callEmbedAtom, incomingCall as never));
    stamp.resolve();
    let headerStarted: boolean | undefined;
    await act(async () => {
      headerStarted = await headerStart;
    });

    expect(headerStarted).toBe(false);
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expectOriginCleared(room.roomId);
    expect(mocks.startCall).not.toHaveBeenCalled();
    expectNoCleanup();
    expect(getDefaultStore().get(callEmbedAtom)).toBe(incomingCall);
    expect(incomingCall.dispose).not.toHaveBeenCalled();
    expect(profile.result.current.loading).toBe(false);
  });
});
