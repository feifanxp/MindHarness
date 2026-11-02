import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { color } from 'folds';
import ProjectWizard from './ProjectWizard';
import { DiscussionNotesPanel } from './DiscussionNotesPanel';
import {
  DiscussionActions,
  type DiscussionSummary,
  type DiscussionAction,
} from './DiscussionActions';
import { type WizardState } from './api';
import { ClientRuntime } from '../app/pages/client/ClientRuntime';
import { HomeRouteRoomProvider } from '../app/pages/client/home/RoomProvider';
import { Room } from '../app/mindroom/threads/MindroomRoom';
import { RoomPathOverrideContext } from '../app/hooks/roomPathOverride';
import { HideThreadModelPickerContext } from '../app/hooks/threadModelPickerVisibility';
import { HideRoomThreadsContext } from '../app/hooks/roomThreadVisibility';
import './discussionSpace.css';

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
    <div className="discussion-room">
      {state.result?.scribe && (
        <DiscussionNotesPanel
          draftId={state.draft_id}
          sourcePath={(eventId) => discussionPath(state.draft_id, state.result?.room_id, eventId)}
        />
      )}
      <div className="discussion-room-timeline">
        <RoomPathOverrideContext.Provider value={override}>
          <HideRoomThreadsContext.Provider value>
            <HideThreadModelPickerContext.Provider value>
              <ClientRuntime>
                <HomeRouteRoomProvider>
                  <Room />
                </HomeRouteRoomProvider>
              </ClientRuntime>
            </HideThreadModelPickerContext.Provider>
          </HideRoomThreadsContext.Provider>
        </RoomPathOverrideContext.Provider>
      </div>
    </div>
  );
}

const renderRoom = (state: WizardState) => <LiveDiscussion state={state} />;

export function DiscussionPage() {
  const params = useParams();
  const legacyDraft = useRef(new URLSearchParams(window.location.search).get('draft'));
  const draftId = params.draftId ?? legacyDraft.current ?? undefined;
  const activeDraft = useRef(draftId);
  activeDraft.current = draftId;
  const navigate = useNavigate();
  const cache = useRef(new Map<string, WizardState>());
  const [items, setItems] = useState<DiscussionSummary[]>([]);
  const [listError, setListError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const archiveView = useRef(showArchived);
  archiveView.current = showArchived;
  const clearLegacyDraft = useCallback(() => {
    legacyDraft.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('draft');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/project-wizard/drafts' + (showArchived ? '?archived=true' : ''), {
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
  }, [refresh, draftId, showArchived]);

  const onSaved = useCallback((state: WizardState) => {
    const previous = cache.current.get(state.draft_id);
    if (previous && state.revision < previous.revision) return;
    cache.current.set(state.draft_id, state);
    setItems((current) => [
      ...(!!state.archived === archiveView.current
        ? [
            {
              draft_id: state.draft_id,
              name: state.display_name ?? state.draft?.project.name ?? '新讨论',
              status: state.status,
              updated_at: Date.now() / 1000,
              revision: state.revision,
              archived: !!state.archived,
            },
          ]
        : []),
      ...current.filter((item) => item.draft_id !== state.draft_id),
    ]);
  }, []);
  const onChanged = useCallback(
    (id: string, action: DiscussionAction, state: WizardState | null) => {
      const previous = cache.current.get(id);
      if (state && previous && state.revision < previous.revision) return;
      if (state) cache.current.set(id, state);
      else cache.current.delete(id);
      if (action === 'rename' && state) onSaved(state);
      else {
        setItems((current) => current.filter((item) => item.draft_id !== id));
        if (action === 'archive' && state && !state.archived) setShowArchived(false);
        if (activeDraft.current === id && (action === 'delete' || state?.archived)) {
          clearLegacyDraft();
          navigate('/discussion', { replace: true });
        }
      }
      setRefresh((value) => value + 1);
    },
    [navigate, onSaved, clearLegacyDraft]
  );
  const onDraftChange = useCallback(
    (id: string) => {
      if (id !== draftId) {
        clearLegacyDraft();
        navigate(discussionPath(id), { replace: true });
      }
    },
    [draftId, navigate, clearLegacyDraft]
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
            clearLegacyDraft();
            setMobileNavOpen(false);
            setShowArchived(false);
            navigate('/discussion');
          }}
        >
          ＋ 新讨论
        </button>
        <span className="discussion-sidebar-label">{showArchived ? '已归档' : '最近讨论'}</span>
        <div className="discussion-history">
          {items.map((item) => (
            <div className="discussion-history-row" key={item.draft_id}>
              <Link
                to={discussionPath(item.draft_id)}
                aria-current={draftId === item.draft_id ? 'page' : undefined}
                onClick={() => setMobileNavOpen(false)}
              >
                <span>{item.name}</span>
                <small>{item.status === 'created' ? '讨论中' : '准备中'}</small>
              </Link>
              <DiscussionActions item={item} onChanged={onChanged} />
            </div>
          ))}
          {showArchived && !items.length && !listError && (
            <p className="discussion-empty">没有已归档讨论</p>
          )}
          {listError && (
            <button type="button" onClick={() => setRefresh((value) => value + 1)}>
              重新加载讨论列表
            </button>
          )}
        </div>
        <button
          type="button"
          className="discussion-archive-toggle"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((value) => !value)}
        >
          {showArchived ? '返回最近讨论' : '已归档讨论'}
        </button>
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
