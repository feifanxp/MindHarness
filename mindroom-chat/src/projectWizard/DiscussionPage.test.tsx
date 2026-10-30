// @vitest-environment jsdom
import React, { useContext, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'jotai';
import { ClientEvent, createClient, type MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiscussionPage } from './DiscussionPage';
import type { WizardState } from './api';
import { MatrixClientProvider } from '../app/hooks/useMatrixClient';
import { useRoom } from '../app/hooks/useRoom';
import { RoomPathOverrideContext } from '../app/hooks/roomPathOverride';
import { ClientStartupProvider } from '../app/pages/client/ClientStartupContext';
import { allRoomsAtom, useBindAllRoomsAtom } from '../app/state/room-list/roomList';

const roomId = '!discussion:example.org';
let mx: MatrixClient;
let renderer: ReactTestRenderer;
let initialSyncComplete: boolean;
const state: WizardState = {
  draft_id: 'draft-1',
  revision: 1,
  status: 'created',
  draft: null,
  messages: [],
  pending_message_id: null,
  error: null,
  progress: null,
  config_installed: true,
  owner_user_id: '@owner:example.org',
  confirmation_key: 'confirmed',
  confirmed_revision: 1,
  test_mode: false,
  result: {
    project_id: 'draft-1',
    test_mode: false,
    room_id: roomId,
    homeserver_url: 'https://example.org',
    team_user_id: '@team:example.org',
    sender_user_id: '@owner:example.org',
    members: [],
  },
};

vi.mock('./ProjectWizard', () => ({
  default: ({ renderRoom }: { renderRoom: (value: WizardState) => ReactNode }) => renderRoom(state),
}));
vi.mock('../app/pages/client/ClientRuntime', () => ({
  ClientRuntime: function Runtime({ children }: { children: ReactNode }) {
    useBindAllRoomsAtom(mx, allRoomsAtom);
    return (
      <MatrixClientProvider value={mx}>
        <ClientStartupProvider hasCompletedInitialSync={initialSyncComplete}>
          {children}
        </ClientStartupProvider>
      </MatrixClientProvider>
    );
  },
}));
vi.mock('../app/mindroom/threads/MindroomRoom', () => ({
  Room: function Timeline() {
    const room = useRoom();
    const override = useContext(RoomPathOverrideContext);
    return <output data-room={room.roomId}>{override?.(room.roomId, '$thread')}</output>;
  },
}));
vi.mock('../app/features/join-before-navigate', () => ({
  JoinBeforeNavigate: ({ roomIdOrAlias }: { roomIdOrAlias: string }) => (
    <button data-join={roomIdOrAlias}>Join room</button>
  ),
}));

beforeEach(() => {
  mx = createClient({ baseUrl: 'https://example.org', userId: '@owner:example.org' });
  initialSyncComplete = true;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
function view() {
  return (
    <Provider>
      <MemoryRouter initialEntries={['/discussion/draft-1/' + encodeURIComponent(roomId)]}>
        <Routes>
          <Route path="/discussion/:draftId/:roomIdOrAlias" element={<DiscussionPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}
async function mount() {
  await act(async () => {
    renderer = create(view());
  });
}
function storeRoom(membership: 'invite' | 'join') {
  const room = new Room(roomId, mx, '@owner:example.org');
  room.updateMyMembership(membership);
  mx.store.storeRoom(room);
  return room;
}

it('offers the native join flow when the new room is not in the client cache', async () => {
  await mount();
  expect(renderer.root.findByProps({ 'data-join': roomId })).toBeTruthy();
  expect(renderer.root.findAllByType('output')).toHaveLength(0);
});

it('does not render an invited room as though the owner has joined', async () => {
  storeRoom('invite');
  await mount();
  expect(renderer.root.findByProps({ 'data-join': roomId })).toBeTruthy();
  expect(renderer.root.findAllByType('output')).toHaveLength(0);
});

it('waits for initial sync before offering room access', async () => {
  initialSyncComplete = false;
  await mount();
  expect(renderer.root.findAllByProps({ 'data-join': roomId })).toHaveLength(0);
  initialSyncComplete = true;
  await act(async () => renderer.update(view()));
  expect(renderer.root.findByProps({ 'data-join': roomId })).toBeTruthy();
});

it('renders the room after a live join and retains discussion thread navigation', async () => {
  const room = storeRoom('invite');
  await mount();
  await act(async () => room.updateMyMembership('join'));
  // MatrixClient forwards room membership changes during sync.
  await act(async () => mx.emit(ClientEvent.Room, room));
  expect(renderer.root.findAllByProps({ 'data-join': roomId })).toHaveLength(0);
  expect(renderer.root.findByType('output').children.join('')).toBe(
    '/discussion/draft-1/' + encodeURIComponent(roomId) + '/%24thread'
  );
});
