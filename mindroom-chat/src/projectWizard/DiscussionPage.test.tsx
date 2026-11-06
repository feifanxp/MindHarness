// @vitest-environment jsdom
import React, { useContext, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Provider } from 'jotai';
import { ClientEvent, createClient, type MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { putSession } from '../app/state/sessions';
import { DiscussionPage } from './DiscussionPage';
import ProjectWizard from './ProjectWizard';
import { logoutClient, removeSessionAndReload } from '../client/initMatrix';
import { DiscussionActions } from './DiscussionActions';
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
let showLiveRoom = true;
let navigate: NavigateFunction;
function NavigationCapture() {
  navigate = useNavigate();
  return null;
}
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
  default: ({ renderRoom }: { renderRoom: (value: WizardState) => ReactNode }) =>
    showLiveRoom ? renderRoom(state) : null,
}));
vi.mock('../client/initMatrix', () => ({ logoutClient: vi.fn(), removeSessionAndReload: vi.fn() }));
vi.mock('./DiscussionActions', () => ({ DiscussionActions: () => null }));
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
  localStorage.clear();
  sessionStorage.clear();
  putSession({
    baseUrl: 'https://example.org',
    userId: '@owner:example.org',
    accessToken: 'token',
    deviceId: 'device',
  });
  mx = createClient({ baseUrl: 'https://example.org', userId: '@owner:example.org' });
  initialSyncComplete = true;
  showLiveRoom = true;
  vi.mocked(logoutClient).mockClear();
  vi.mocked(removeSessionAndReload).mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});
afterEach(() => {
  act(() => renderer?.unmount());
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});
function view() {
  return (
    <Provider>
      <MemoryRouter initialEntries={['/discussion/draft-1/' + encodeURIComponent(roomId)]}>
        <NavigationCapture />
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
  showLiveRoom = true;
  vi.mocked(logoutClient).mockClear();
  vi.mocked(removeSessionAndReload).mockClear();
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

it('keeps pending saves out of the archive view without restarting the wizard', async () => {
  await mount();
  const onSaved = renderer.root.findByType(ProjectWizard).props.onSaved;
  await act(async () =>
    renderer.root.findByProps({ className: 'discussion-archive-toggle' }).props.onClick()
  );
  expect(renderer.root.findByType(ProjectWizard).props.onSaved).toBe(onSaved);
  await act(async () => onSaved({ ...state, display_name: '尚未归档的讨论' }));
  expect(renderer.root.findAllByProps({ className: 'discussion-history-row' })).toHaveLength(0);
  await act(async () => onSaved({ ...state, archived: true, display_name: '已归档的讨论' }));
  expect(renderer.root.findAllByProps({ className: 'discussion-history-row' })).toHaveLength(1);
});

it('keeps the newer sidebar title and cache when an earlier save arrives late', async () => {
  await mount();
  const onSaved = renderer.root.findByType(ProjectWizard).props.onSaved;
  const renamed = { ...state, revision: 2, display_name: '保留新名称' };
  await act(async () => onSaved(renamed));
  await act(async () => onSaved(state));
  expect(renderer.root.findByType(ProjectWizard).props.initialState).toEqual(renamed);
  expect(
    renderer.root.findByProps({ className: 'discussion-history-row' }).findByType('span').children
  ).toEqual(['保留新名称']);
});

it('keeps the newly opened discussion when a previous archive finishes late', async () => {
  await mount();
  await act(async () => renderer.root.findByType(ProjectWizard).props.onSaved(state));
  const finishArchive = renderer.root.findByType(DiscussionActions).props.onChanged;
  await act(async () => navigate('/discussion/draft-2/' + encodeURIComponent(roomId)));
  await act(async () =>
    finishArchive('draft-1', 'archive', { ...state, revision: 2, archived: true })
  );
  expect(renderer.root.findByType(ProjectWizard).props.draftId).toBe('draft-2');
});

it.each(['delete', 'archive'])(
  'clears legacy draft URLs after %s so reload cannot reopen them',
  async (action) => {
    window.history.replaceState(null, '', '/?draft=draft-1');
    await mount();
    await act(async () => renderer.root.findByType(ProjectWizard).props.onSaved(state));
    await act(async () =>
      renderer.root
        .findByType(DiscussionActions)
        .props.onChanged(
          'draft-1',
          action,
          action === 'delete' ? null : { ...state, revision: 2, archived: true }
        )
    );
    expect(new URL(window.location.href).searchParams.has('draft')).toBe(false);
  }
);

it('logs out the actual live Matrix runtime', async () => {
  await mount();
  await act(async () =>
    renderer.root
      .findAllByType('button')
      .find((button) => button.children.includes('退出登录'))!
      .props.onClick()
  );
  expect(logoutClient).toHaveBeenCalledWith(mx);
  expect(removeSessionAndReload).not.toHaveBeenCalled();
});

it('cleans the stored account even when Matrix logout fails before room entry', async () => {
  showLiveRoom = false;
  await mount();
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes('_matrix')) throw new Error('Expired token');
    return { ok: true, json: async () => [] } as Response;
  });
  await act(async () =>
    renderer.root
      .findAllByType('button')
      .find((button) => button.children.includes('退出登录'))!
      .props.onClick()
  );
  expect(removeSessionAndReload).toHaveBeenCalledWith(
    expect.objectContaining({ userId: '@owner:example.org' })
  );
});
