import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { MINDROOM_SERVER_EVENT, type MindroomServer } from './mindroomServer';
import { useBindsOpenIdTokens, useRoomMindroomServers } from './useMindroomServers';

const native = vi.hoisted(() => ({ isNativePlatform: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNativePlatform },
}));

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';
let serial = 0;
let renderer: ReactTestRenderer | undefined;

const stateEvent = (type: string, stateKey: string, content: Record<string, unknown>) => {
  serial += 1;
  return new MatrixEvent({
    type,
    state_key: stateKey,
    sender: type === 'm.room.topic' ? viewer : stateKey,
    room_id: '!room:example.org',
    event_id: `$state${serial}`,
    origin_server_ts: serial,
    content,
  });
};

const serverEvent = (apiOrigin: string) =>
  stateEvent(MINDROOM_SERVER_EVENT, agent, { api_origin: apiOrigin, computer: true });
const membership = (value: string) => stateEvent('m.room.member', agent, { membership: value });

const makeRoom = () =>
  new Room(
    '!room:example.org',
    createClient({ baseUrl: 'http://localhost:1', userId: viewer, timelineSupport: true }),
    viewer,
    { timelineSupport: true }
  );

const mount = (room: Room) => {
  const seen: MindroomServer[][] = [];
  function Probe() {
    seen.push(useRoomMindroomServers(room));
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });
  return seen;
};

const addState = (room: Room, event: MatrixEvent) =>
  act(async () => {
    await room.addLiveEvents([event], { addToState: true });
  });

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('follows an agent that moves to another server and drops it once it leaves', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), serverEvent('http://localhost:8765')], {
    addToState: true,
  });
  const seen = mount(room);
  expect(seen.at(-1)?.map((server) => server.apiUrl)).toEqual(['http://localhost:8765']);

  await addState(room, serverEvent('https://mind.example.org'));
  expect(seen.at(-1)?.map((server) => server.apiUrl)).toEqual(['https://mind.example.org']);

  await addState(room, membership('leave'));
  expect(seen.at(-1)).toEqual([]);
});

it('does not render again for unrelated room state', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), serverEvent('http://localhost:8765')], {
    addToState: true,
  });
  const seen = mount(room);
  const renders = seen.length;

  await addState(room, stateEvent('m.room.topic', '', { topic: 'Release prep' }));

  expect(seen).toHaveLength(renders);
});

it('asks the homeserver again after a check that could not reach it', async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: viewer });
  const versions = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          versions: ['v1.11'],
          unstable_features: { 'io.mindroom.openid_audience': true },
        }),
        { status: 200 }
      )
    );
  vi.stubGlobal('fetch', versions);
  const mountBinding = async () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useBindsOpenIdTokens());
      return null;
    }
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <Probe />
        </MatrixClientProvider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => renderer?.unmount());
    renderer = undefined;
    return seen.at(-1);
  };
  expect(await mountBinding()).toBe(false);
  expect(await mountBinding()).toBe(true);
  expect(await mountBinding()).toBe(true);
  expect(versions).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});

it('ignores a published localhost server in the native apps, where it is the phone itself', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), serverEvent('http://localhost:8765')], {
    addToState: true,
  });
  native.isNativePlatform = true;
  const seen = mount(room);
  expect(seen.at(-1)).toEqual([]);
  native.isNativePlatform = false;
});
