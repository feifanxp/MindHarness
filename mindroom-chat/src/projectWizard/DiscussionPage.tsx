import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { color } from 'folds';
import ProjectWizard from './ProjectWizard';
import { type WizardState } from './api';
import { ClientRuntime } from '../app/pages/client/ClientRuntime';
import { Room } from '../app/mindroom/threads/MindroomRoom';
import { RoomPathOverrideContext } from '../app/hooks/roomPathOverride';
import { IsDirectRoomProvider, RoomProvider } from '../app/hooks/useRoom';
import { useMatrixClient } from '../app/hooks/useMatrixClient';
import './discussionSpace.css';

type DiscussionSummary = { draft_id: string; name: string; status: string; updated_at: number };

export const discussionPath = (draftId: string, roomId?: string, eventId?: string) =>
  `/discussion/${encodeURIComponent(draftId)}${roomId ? `/${encodeURIComponent(roomId)}` : ''}${
    roomId && eventId ? `/${encodeURIComponent(eventId)}` : ''
  }`;

const theme = {
  '--discussion-background': color.Background.Container,
  '--discussion-surface': color.Surface.Container,
  '--discussion-subtle': color.SurfaceVariant.Container,
  '--discussion-text': color.Surface.OnContainer,
  '--discussion-muted': color.Secondary.Main,
  '--discussion-line': color.Surface.ContainerLine,
  '--discussion-accent': color.Primary.Main,
  '--discussion-accent-soft': color.Primary.Container,
  '--discussion-on-accent': color.Primary.OnMain,
  '--discussion-danger': color.Critical.Main,
  '--discussion-danger-soft': color.Critical.Container,
} as CSSProperties;

function LiveDiscussion({ state }: { state: WizardState }) {
  const override = useCallback(
    (roomId: string, eventId?: string) =>
      roomId === state.result?.room_id
        ? discussionPath(state.draft_id, roomId, eventId)
        : undefined,
    [state.draft_id, state.result?.room_id]
  );
  return (
    <RoomPathOverrideContext.Provider value={override}>
      <ClientRuntime>
        <LiveRoom state={state} />
      </ClientRuntime>
    </RoomPathOverrideContext.Provider>
  );
}

function LiveRoom({ state }: { state: WizardState }) {
  const mx = useMatrixClient();
  const roomId = state.result?.room_id;
  const room = roomId ? mx.getRoom(roomId) : undefined;
  if (!room)
    return (
      <div className="discussion-room-loading" role="status">
        正在加载聊天室…
      </div>
    );
  return (
    <RoomProvider key={room.roomId} value={room}>
      <IsDirectRoomProvider value={false}>
        <Room />
      </IsDirectRoomProvider>
    </RoomProvider>
  );
}

const renderRoom = (state: WizardState) => <LiveDiscussion state={state} />;

export function DiscussionPage() {
  const params = useParams();
  const legacyDraft = useRef(new URLSearchParams(window.location.search).get('draft'));
  const draftId = params.draftId ?? legacyDraft.current ?? undefined;
  const navigate = useNavigate();
  const cache = useRef(new Map<string, WizardState>());
  const [items, setItems] = useState<DiscussionSummary[]>([]);
  const [listError, setListError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/project-wizard/drafts', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Cannot load discussions');
        const entries: DiscussionSummary[] = await response.json();
        if (!Array.isArray(entries)) throw new Error('Invalid discussion list');
        if (!controller.signal.aborted) {
          setItems(entries);
          setListError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setListError(true);
      });
    return () => controller.abort();
  }, [refresh, draftId]);

  const onSaved = useCallback((state: WizardState) => {
    cache.current.set(state.draft_id, state);
    setItems((current) => [
      {
        draft_id: state.draft_id,
        name: state.draft?.project.name ?? '新讨论',
        status: state.status,
        updated_at: Date.now() / 1000,
      },
      ...current.filter((item) => item.draft_id !== state.draft_id),
    ]);
  }, []);
  const onDraftChange = useCallback(
    (id: string) => {
      if (id !== draftId) {
        const url = new URL(window.location.href);
        url.searchParams.delete('draft');
        window.history.replaceState(window.history.state, '', url);
        legacyDraft.current = null;
        navigate(discussionPath(id), { replace: true });
      }
    },
    [draftId, navigate]
  );
  const onRoomReady = useCallback(
    (state: WizardState) => {
      if (state.result && params.roomIdOrAlias !== state.result.room_id) {
        navigate(discussionPath(state.draft_id, state.result.room_id), { replace: true });
      }
    },
    [navigate, params.roomIdOrAlias]
  );

  return (
    <div className="discussion-space" style={theme}>
      <button
        className="discussion-nav-toggle"
        type="button"
        aria-expanded={mobileNavOpen}
        aria-controls="discussion-navigation"
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
      >
        我的讨论
      </button>
      <nav
        id="discussion-navigation"
        className={`discussion-sidebar ${mobileNavOpen ? 'discussion-sidebar-open' : ''}`}
        aria-label="我的讨论"
      >
        <strong className="discussion-sidebar-title">Agent Room</strong>
        <button
          className="discussion-new"
          type="button"
          onClick={() => {
            legacyDraft.current = null;
            const url = new URL(window.location.href);
            url.searchParams.delete('draft');
            window.history.replaceState(window.history.state, '', url);
            setMobileNavOpen(false);
            navigate('/discussion');
          }}
        >
          ＋ 新讨论
        </button>
        <span className="discussion-sidebar-label">最近讨论</span>
        <div className="discussion-history">
          {items.map((item) => (
            <Link
              key={item.draft_id}
              to={discussionPath(item.draft_id)}
              aria-current={draftId === item.draft_id ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              <span>{item.name}</span>
              <small>{item.status === 'created' ? '讨论中' : '准备中'}</small>
            </Link>
          ))}
          {listError && (
            <button type="button" onClick={() => setRefresh((value) => value + 1)}>
              重新加载讨论列表
            </button>
          )}
        </div>
        <Link className="discussion-more" to="/home">
          更多聊天功能
        </Link>
      </nav>
      <ProjectWizard
        key={draftId ?? 'new'}
        workspaceMode
        draftId={draftId}
        initialState={draftId ? cache.current.get(draftId) : undefined}
        onSaved={onSaved}
        onDraftChange={onDraftChange}
        onRoomReady={onRoomReady}
        renderRoom={renderRoom}
      />
    </div>
  );
}
