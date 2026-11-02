import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'folds';

const categories = {
  fact: '已确认的信息',
  idea: '观点与方案',
  decision: '已作出的决定',
  question: '分歧与待确认',
  action: '下一步行动',
};

export type DiscussionNotes = {
  overview: string;
  items: {
    id: string;
    category: keyof typeof categories;
    text: string;
    source_event_ids: string[];
  }[];
  updated_at: number | null;
  checked_at: number | null;
  status: 'waiting' | 'running' | 'ready' | 'error';
  error: string | null;
  pending_messages: number;
};

async function requestNotes(
  draftId: string,
  signal: AbortSignal,
  refresh = false
): Promise<DiscussionNotes> {
  const response = await fetch(
    `/api/project-wizard/drafts/${encodeURIComponent(draftId)}/notes${refresh ? '/refresh' : ''}`,
    { method: refresh ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal }
  );
  if (response.status === 401) throw new Error('登录已过期，请刷新页面重新登录。');
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value?.detail === 'string' ? value.detail : '暂时无法读取讨论成果，请重试。'
    );
  if (!value || !Array.isArray(value.items) || typeof value.overview !== 'string') {
    throw new Error('讨论成果格式无效，请重试。');
  }
  return value as DiscussionNotes;
}

export function DiscussionNotesPanel({
  draftId,
  sourcePath,
}: {
  draftId: string;
  sourcePath: (eventId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<DiscussionNotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);
  const refreshController = useRef<AbortController | null>(null);

  useEffect(() => () => refreshController.current?.abort(), [draftId]);
  useEffect(() => {
    if (!open || refreshing) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await requestNotes(draftId, controller.signal);
        if (!controller.signal.aborted) {
          setNotes(value);
          setError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '暂时无法读取讨论成果。');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 10_000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [draftId, open, refreshing, reload]);

  const refresh = async () => {
    if (refreshController.current) return;
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshing(true);
    setError(null);
    const timeout = setTimeout(() => {
      controller.abort();
      setError('整理请求超时，可重试；后台整理会继续运行。');
    }, 130_000);
    try {
      const value = await requestNotes(draftId, controller.signal, true);
      if (!controller.signal.aborted) setNotes(value);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '整理失败，请重试。');
    } finally {
      clearTimeout(timeout);
      refreshController.current = null;
      setRefreshing(false);
    }
  };

  return (
    <details className="discussion-notes" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        讨论成果 <span>整理员 BOT · 后台运行</span>
      </summary>
      <div className="discussion-notes-body">
        <div className="discussion-notes-actions">
          <p role="status" aria-live="polite">
            {refreshing || notes?.status === 'running'
              ? '正在整理…'
              : notes?.updated_at
              ? `最近整理：${new Date(notes.updated_at * 1000).toLocaleString()}`
              : notes
              ? '有价值的新内容会自动整理到这里。'
              : '正在读取讨论成果…'}
          </p>
          <Button
            size="300"
            fill="Soft"
            outlined
            radii="300"
            variant="Primary"
            disabled={refreshing || notes?.status === 'running'}
            onClick={() => void refresh()}
          >
            立即整理
          </Button>
        </div>
        {(error || notes?.error) && (
          <p role="alert">
            {error || notes?.error}{' '}
            <button type="button" onClick={() => setReload((value) => value + 1)}>
              重新加载
            </button>
          </p>
        )}
        {!!notes?.pending_messages && (
          <p className="discussion-notes-muted">还有 {notes.pending_messages} 条消息待整理</p>
        )}
        {notes?.overview && <p className="discussion-notes-overview">{notes.overview}</p>}
        {notes && !notes.items.length && (
          <p className="discussion-notes-muted">
            暂时没有摘录。整理员会保留事实、观点、决定、分歧和明确的行动，并附上原文出处。
          </p>
        )}
        {Object.entries(categories).map(([category, label]) => {
          const items = notes?.items.filter((item) => item.category === category) ?? [];
          return (
            items.length > 0 && (
              <section key={category} aria-label={label}>
                <h3>{label}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <p>{item.text}</p>
                      <div className="discussion-notes-sources">
                        {item.source_event_ids.map((eventId, index) => (
                          <Link
                            key={eventId}
                            to={sourcePath(eventId)}
                            aria-label={`${label}：查看原文 ${index + 1}`}
                          >
                            原文 {index + 1}
                          </Link>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          );
        })}
      </div>
    </details>
  );
}
