import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { IconArrowUp, IconRefresh, IconSparkles } from '@tabler/icons-react';
import parse from 'html-react-parser';
import { parseBlockMD, parseInlineMD } from '../app/plugins/markdown';
import { sanitizeCustomHtml, sanitizeText } from '../app/utils/sanitize';
import { wizardRequest, WizardError, type WizardState, type ProjectMode } from './api';
import {
  listSessions,
  setActiveSession,
  putSession,
  normalizeSessionBaseUrl,
} from '../app/state/sessions';
import { TeammatePicker } from './TeammatePicker';
import './projectWizard.css';

const examples = ['聊聊一个新产品想法', '分析一个正在遇到的问题', '一起想想周末做什么'];
const modeLabels: Record<ProjectMode, string> = {
  parallel: '平行讨论',
  hierarchical: '主从执行',
  needs_clarification: '还需澄清',
};

type Props = {
  workspaceMode?: boolean;
  draftId?: string;
  initialState?: WizardState;
  onSaved?: (state: WizardState) => void;
  onDraftChange?: (draftId: string) => void;
  onRoomReady?: (state: WizardState) => void;
  renderRoom?: (state: WizardState) => ReactNode;
};

export default function ProjectWizard({
  workspaceMode = false,
  draftId,
  initialState,
  onSaved,
  onDraftChange,
  onRoomReady,
  renderRoom,
}: Props = {}) {
  const [saved, setSaved] = useState<WizardState | null>(initialState ?? null);
  const current = useRef<WizardState | null>(initialState ?? null);
  const initialDraftId = useRef(
    draftId ?? (workspaceMode ? null : new URLSearchParams(window.location.search).get('draft'))
  );
  const initialDraftPath = initialDraftId.current
    ? '/drafts/' + encodeURIComponent(initialDraftId.current)
    : workspaceMode
    ? null
    : '/drafts/latest';
  const [loading, setLoading] = useState(true);
  const [mobilePlanOpen, setMobilePlanOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [authError, setAuthError] = useState('');
  const [projectName, setProjectName] = useState('');
  const [pendingLabel, setPendingLabel] = useState('正在保存更改…');
  const [connected, setConnected] = useState(false);
  const autoConnect = useRef<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const retryAction = useRef<(() => Promise<void>) | null>(null);
  const messages = saved?.messages ?? [];
  const selectedAgents = saved?.draft?.agents.filter((agent) => agent.selected) ?? [];
  const projectDraft = saved?.draft ?? null;
  const serverBusy =
    !!saved &&
    !saved.error &&
    (!!saved.pending_message_id || ['confirmed', 'provisioning'].includes(saved.status));
  const frozen =
    !!saved && ['confirmed', 'provisioning', 'created', 'provision_failed'].includes(saved.status);
  const disabled = loading || pending || serverBusy || frozen || !!saved?.pending_message_id;

  const accept = useCallback(
    (value: WizardState | null, navigate = true) => {
      if (!alive.current) return;
      current.current = value;
      setSaved(value);
      setProjectName(value?.draft?.project.name ?? '');
      if (value) {
        onSaved?.(value);
        if (onDraftChange && navigate) {
          onDraftChange(value.draft_id);
        } else if (!workspaceMode || !navigate) {
          const url = new URL(window.location.href);
          url.searchParams.set('draft', value.draft_id);
          window.history.replaceState(window.history.state, '', url);
        }
      }
    },
    [onSaved, onDraftChange, workspaceMode]
  );
  const report = useCallback((cause: unknown) => {
    if (cause instanceof WizardError && cause.status === 401) setAuthRequired(true);
    else setError(cause instanceof Error ? cause.message : '连接失败，请重试。');
  }, []);
  const restore = useCallback(async () => {
    if (busy.current) return;
    const before = current.current;
    if (!current.current && !initialDraftPath) return;
    try {
      const value = await wizardRequest(
        current.current ? `/drafts/${current.current.draft_id}` : initialDraftPath!
      );
      if (busy.current || current.current !== before || !alive.current) return;
      accept(value);
      setError('');
    } catch (cause) {
      report(cause);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [accept, report, initialDraftPath]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const restored = initialDraftPath ? wizardRequest(initialDraftPath) : Promise.resolve(null);
    void restored
      .then((value) => {
        if (!cancelled) {
          accept(value);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          report(cause);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [accept, report, initialDraftPath]);
  useEffect(() => {
    if (!serverBusy || pending) return undefined;
    const timer = window.setTimeout(() => {
      void restore();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [serverBusy, pending, saved, restore]);

  const run = async (action: () => Promise<void>, recoveryKey?: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setPendingLabel('正在保存更改…');
    setError('');
    retryAction.current = () => run(action, recoveryKey);
    try {
      await action();
      retryAction.current = null;
    } catch (cause) {
      if (current.current) {
        try {
          const expectedKey = recoveryKey;
          const recovered = await wizardRequest(`/drafts/${current.current.draft_id}`);
          accept(recovered);
          if (
            expectedKey &&
            recovered?.status === 'created' &&
            recovered.result &&
            recovered.confirmation_key === expectedKey
          ) {
            retryAction.current = null;
            setError('');
            return;
          }
        } catch {
          /* Keep the last saved snapshot visible during a connection failure. */
        }
      }
      if (cause instanceof WizardError && cause.status === 409) {
        retryAction.current = null;
      }
      report(cause);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const newProject = () => {
    if (loading || serverBusy || busy.current || authRequired) return;
    void run(async () => {
      const created = await wizardRequest('/drafts', 'POST');
      if (!created) throw new Error('无法开始新讨论，请重试。');
      setConnected(false);
      autoConnect.current = null;
      accept(created);
      setDraft('');
      setMobilePlanOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  };
  const send = async (content: string, messageId: string) => {
    setPendingLabel('讨论助手正在梳理需求并匹配 AI 队友…');
    let state = current.current;
    if (!state) {
      state = await wizardRequest('/drafts', 'POST');
      if (!state) throw new Error('无法建立草稿，请重试。');
      accept(state, false);
    }
    const value = await wizardRequest(`/drafts/${state.draft_id}/messages`, 'POST', {
      content,
      message_id: messageId,
      revision: state.revision,
    });
    accept(value);
    setDraft('');
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || disabled || busy.current || authRequired || error) return;
    const id = crypto.randomUUID();
    void run(() => send(content, id));
  };
  const retry = () => {
    const state = current.current;
    if (state?.pending_message_id && state.error) {
      const message = state.messages.find((item) => item.id === state.pending_message_id);
      if (message) void run(() => send(message.content, message.id));
    } else if (retryAction.current) void retryAction.current();
    else void restore();
  };
  const rename = async () => {
    const name = projectName.trim();
    const state = current.current;
    if (!state?.draft || !name || name === state.draft.project.name) {
      setProjectName(state?.draft?.project.name ?? '');
      return;
    }
    await run(async () =>
      accept(
        await wizardRequest(`/drafts/${state.draft_id}`, 'PATCH', {
          name,
          revision: state.revision,
        })
      )
    );
  };
  const selectMembers = (names: string[]) => {
    const state = current.current;
    if (!state?.draft || disabled || busy.current || authRequired || error) return;
    void run(async () => {
      setPendingLabel('正在保存队友选择…');
      accept(
        await wizardRequest(`/drafts/${state.draft_id}/members`, 'PATCH', {
          revision: state.revision,
          names,
        })
      );
    });
  };
  const confirm = async (state: WizardState, key: string) => {
    if (busy.current) return;
    await run(async () => {
      setPendingLabel('正在邀请选中的队友，准备聊天室…');
      accept(
        await wizardRequest(`/drafts/${state.draft_id}/confirm`, 'POST', {
          revision: state.confirmed_revision ?? state.revision,
          idempotency_key: key,
        })
      );
    }, key);
    if (
      alive.current &&
      current.current?.status === 'created' &&
      current.current.confirmation_key === key
    ) {
      await startChat();
    } else if (retryAction.current) {
      retryAction.current = () => confirm(state, key);
    }
  };
  const startChat = async () => {
    const state = current.current;
    if (!state?.result || state.result.test_mode || !state.owner_user_id) return;
    await run(async () => {
      setPendingLabel('正在进入聊天室…');
      const result = state.result!;
      const existing = listSessions().find(
        (session) =>
          session.userId === state.owner_user_id &&
          normalizeSessionBaseUrl(session.baseUrl) ===
            normalizeSessionBaseUrl(result.homeserver_url)
      );
      if (existing) {
        setActiveSession(existing.sessionId);
      } else {
        const response = await fetch(`/api/project-wizard/drafts/${state.draft_id}/chat-session`, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const session = await response.json();
        if (!response.ok) {
          throw new WizardError(
            response.status,
            typeof session.detail === 'string' ? session.detail : '聊天登录失败，请重试。'
          );
        }
        if (
          session.user_id !== state.owner_user_id ||
          session.room_id !== result.room_id ||
          normalizeSessionBaseUrl(session.base_url) !==
            normalizeSessionBaseUrl(result.homeserver_url) ||
          typeof session.access_token !== 'string' ||
          typeof session.device_id !== 'string'
        ) {
          throw new Error('聊天登录身份不匹配，请重新加载讨论。');
        }
        putSession(
          {
            baseUrl: session.base_url,
            userId: session.user_id,
            accessToken: session.access_token,
            deviceId: session.device_id,
          },
          { setActive: true }
        );
      }
      if (!alive.current) return;
      setConnected(true);
      onRoomReady?.(state);
    });
  };

  const startChatRef = useRef(startChat);
  startChatRef.current = startChat;
  useEffect(() => {
    if (
      !workspaceMode ||
      !saved ||
      saved.status !== 'created' ||
      loading ||
      pending ||
      authRequired ||
      connected ||
      autoConnect.current === saved.draft_id
    )
      return;
    autoConnect.current = saved.draft_id;
    void startChatRef.current();
  }, [workspaceMode, saved, loading, pending, authRequired, connected]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError('');
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) throw new Error('密钥无效，请重试。');
      setAuthRequired(false);
      setApiKey('');
      await restore();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : '登录失败');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.nativeEvent.keyCode !== 229
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const composer = (
    <div className="wizard-compose-area">
      {(error || saved?.error) && (
        <div className="wizard-error" role="alert">
          <span>{error || saved?.error}</span>
          <button type="button" disabled={pending} onClick={retry}>
            <IconRefresh size={16} />
            重试
          </button>
        </div>
      )}
      <form className="wizard-composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          id="project-prompt"
          aria-label="描述你想讨论的内容"
          aria-describedby="wizard-composer-hint"
          name="message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="说说你想聊的事…"
          rows={1}
          maxLength={4000}
          disabled={disabled || authRequired || !!error}
        />
        <button
          className="wizard-send"
          type="submit"
          disabled={!draft.trim() || disabled || authRequired || !!error}
          aria-label="发送"
        >
          <IconArrowUp size={21} />
        </button>
      </form>
      <div className="wizard-hint" id="wizard-composer-hint">
        <span>Enter 发送 · Shift + Enter 换行</span>
        <span>草稿与对话自动保存</span>
      </div>
    </div>
  );

  return (
    <main className={`wizard-shell ${messages.length ? 'wizard-shell-chat' : ''}`}>
      <header className="wizard-header">
        <div className="wizard-brand">
          <span className="wizard-mark">
            <IconSparkles size={18} />
          </span>
          <span>Agent Room</span>
          <span className="wizard-slash">/</span>
          <span className="wizard-label">{connected ? '一起讨论' : '开始讨论'}</span>
        </div>
        <nav className="wizard-header-actions" aria-label="讨论操作">
          {connected && (
            <span className="wizard-present-members" aria-label="已加入的队友">
              {selectedAgents.map((agent) => (
                <span key={agent.name} title={agent.name}>
                  {agent.avatar_id !== null ? (
                    <img src={`/api/project-wizard/avatars/${agent.avatar_id}`} alt={agent.name} />
                  ) : (
                    agent.name
                  )}
                </span>
              ))}
            </span>
          )}
          <button
            className="wizard-new-project"
            type="button"
            disabled={loading || pending || serverBusy || authRequired || !saved}
            onClick={newProject}
            title="开始一段新的讨论，已有内容和聊天室会保留"
          >
            开始新讨论
          </button>
        </nav>
      </header>

      <section className={`wizard-content ${messages.length ? 'wizard-content-chat' : ''}`}>
        {!messages.length ? (
          <>
            <div className="wizard-welcome">
              <span className="wizard-eyebrow">从一个话题开始</span>
              <h1>今天想聊点什么？</h1>
              {loading && <p role="status">正在恢复草稿…</p>}
              {pending && <p role="status">{pendingLabel}</p>}
              <p>说说你最近在想什么，我们一起把问题聊清楚，也可以随时听听不同的看法。</p>
              <div className="wizard-examples">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setDraft(example);
                      inputRef.current?.focus();
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
            {composer}
          </>
        ) : (
          <div className={`wizard-workspace ${projectDraft ? 'wizard-workspace-plan' : ''}`}>
            <div className="wizard-chat-column">
              {connected && renderRoom && saved ? (
                <>
                  <details className="wizard-preparation">
                    <summary>
                      需求准备 · {selectedAgents.map((agent) => agent.name).join('、')} 已加入
                    </summary>
                    <div className="wizard-preparation-history">
                      {messages.map((message) => (
                        <article key={message.id}>
                          <strong>{message.role === 'user' ? '你' : '讨论助手'}</strong>
                          <p>{message.content}</p>
                        </article>
                      ))}
                      <p>讨论目标：{projectDraft?.project.goal}</p>
                    </div>
                  </details>
                  <div className="wizard-live-room">{renderRoom(saved)}</div>
                </>
              ) : (
                <>
                  <div className="wizard-thread" role="log" aria-live="polite">
                    {messages.map((message) => (
                      <article className={`wizard-message wizard-${message.role}`} key={message.id}>
                        <span className="wizard-message-role">
                          {message.role === 'user' ? '你' : '讨论助手'}
                        </span>
                        {message.role === 'assistant' ? (
                          <div className="wizard-message-body">
                            {parse(
                              sanitizeCustomHtml(
                                parseBlockMD(sanitizeText(message.content), parseInlineMD)
                              )
                            )}
                          </div>
                        ) : (
                          <p>{message.content}</p>
                        )}
                      </article>
                    ))}
                    {(pending || serverBusy) && (
                      <div className="wizard-pending" role="status">
                        {serverBusy
                          ? saved?.progress ?? '正在梳理需求并匹配 AI 队友…'
                          : pendingLabel}
                      </div>
                    )}
                    <div ref={bottomRef} />
                    {projectDraft?.status === 'proposal_ready' && (
                      <TeammatePicker
                        agents={frozen ? selectedAgents : projectDraft.agents}
                        disabled={disabled || authRequired || !!error}
                        frozen={frozen}
                        onSelect={selectMembers}
                      />
                    )}
                  </div>
                  {projectDraft?.status === 'proposal_ready' && !frozen && (
                    <div className="wizard-team-action">
                      <p>
                        {selectedAgents.length
                          ? `已选择 ${selectedAgents.length} 位 AI 队友，准备好就出发。`
                          : '至少选择一位 AI 队友。'}
                      </p>
                      <button
                        className="wizard-confirm"
                        type="button"
                        disabled={
                          disabled ||
                          authRequired ||
                          !!error ||
                          !selectedAgents.length ||
                          projectName.trim() !== projectDraft.project.name
                        }
                        onClick={() => {
                          if (saved) void confirm(saved, crypto.randomUUID());
                        }}
                      >
                        组队，开始聊
                      </button>
                    </div>
                  )}
                  {composer}
                </>
              )}
            </div>

            {projectDraft && (
              <button
                className="wizard-plan-mobile-toggle"
                type="button"
                aria-expanded={mobilePlanOpen}
                aria-controls="wizard-plan-panel"
                onClick={() => setMobilePlanOpen(!mobilePlanOpen)}
              >
                {mobilePlanOpen ? '收起讨论提纲' : `查看讨论提纲 · v${projectDraft.revision}`}
              </button>
            )}

            {projectDraft && (
              <aside
                id="wizard-plan-panel"
                className={`wizard-plan-panel ${mobilePlanOpen ? 'wizard-plan-panel-open' : ''}`}
                aria-label="讨论提纲预览"
              >
                <div className="wizard-plan-heading">
                  <h2>讨论提纲</h2>
                  <span>v{projectDraft.revision}</span>
                </div>
                {projectDraft.status === 'needs_clarification' && (
                  <p className="wizard-plan-status">继续补充信息，讨论提纲会随对话更新。</p>
                )}
                {saved?.status === 'provision_failed' && (
                  <section className="wizard-confirm-summary" role="alert">
                    <h3>开始讨论失败</h3>
                    <p>{saved.error}</p>
                    <p>
                      {saved.config_installed
                        ? '配置已保存，部分 Bot 可能尚未上线。请先重试。'
                        : '聊天室或 Bot 可能尚未建立。请查看错误后重试。'}
                    </p>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (saved.confirmation_key) void confirm(saved, saved.confirmation_key);
                      }}
                    >
                      重试开始讨论
                    </button>
                    <button
                      type="button"
                      disabled={pending || saved.config_installed}
                      onClick={() => {
                        void run(async () =>
                          accept(
                            await wizardRequest(`/drafts/${saved.draft_id}/reopen`, 'POST', {
                              revision: saved.revision,
                              idempotency_key: saved.confirmation_key,
                            })
                          )
                        );
                      }}
                    >
                      返回调整讨论
                    </button>
                  </section>
                )}
                {saved?.result && !connected && (
                  <section className="wizard-confirm-summary" role="status">
                    <h3>聊天室已准备好</h3>
                    <p>聊天室和 Bot 已准备好，可以开始交流。</p>
                    <p>现在可以打开聊天入口开始讨论。</p>
                    {saved?.result && saved.result.test_mode === false && (
                      <button
                        type="button"
                        className="wizard-confirm"
                        disabled={pending}
                        onClick={() => {
                          void startChat();
                        }}
                      >
                        {pending ? '正在进入聊天室…' : '开始聊天'}
                      </button>
                    )}
                  </section>
                )}
                <label className="wizard-plan-name" htmlFor="wizard-project-name">
                  讨论标题
                  <input
                    id="wizard-project-name"
                    name="project_name"
                    maxLength={120}
                    value={projectName}
                    disabled={disabled}
                    onChange={(event) => setProjectName(event.target.value)}
                    onBlur={() => {
                      void rename();
                    }}
                  />
                </label>
                <section className="wizard-plan-section">
                  <h3>想聊的事情</h3>
                  <p>{projectDraft.project.goal}</p>
                </section>
                <section className="wizard-plan-section">
                  <h3>希望聊清楚</h3>
                  {projectDraft.project.expected_outcomes.length ? (
                    <ul>
                      {projectDraft.project.expected_outcomes.map((outcome) => (
                        <li key={outcome}>{outcome}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>待明确</p>
                  )}
                </section>
                <section className="wizard-plan-section">
                  <h3>协作方式</h3>
                  <span className="wizard-mode-label">
                    {modeLabels[projectDraft.collaboration.mode]}
                  </span>
                  <p>{projectDraft.collaboration.rationale}</p>
                </section>
                {!!projectDraft.project.constraints.length && (
                  <section className="wizard-plan-section">
                    <h3>需要考虑</h3>
                    <ul>
                      {projectDraft.project.constraints.map((constraint) => (
                        <li key={constraint}>{constraint}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {!!projectDraft.project.open_questions.length && (
                  <section className="wizard-plan-section">
                    <h3>还要确认</h3>
                    <ul>
                      {projectDraft.project.open_questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <p className="wizard-plan-edit-hint">
                  直接说“换一位更有创意的设计师”，或描述你希望调整的专长和性格。
                </p>
                <button
                  type="button"
                  className="wizard-plan-edit"
                  disabled={disabled}
                  onClick={() => {
                    setMobilePlanOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  调整队友和讨论方式
                </button>
                <p className="wizard-plan-edit-hint">只邀请你选中的 AI 队友加入聊天室。</p>
              </aside>
            )}
          </div>
        )}
      </section>

      {authRequired && (
        <div className="wizard-overlay">
          <form className="wizard-login" onSubmit={login}>
            <span className="wizard-eyebrow">连接 MindRoom</span>
            <h2>需要 API 密钥</h2>
            <p>请输入此 MindRoom 实例的 API 密钥。密钥仅用于建立安全会话，不会发送给语言模型。</p>
            <label htmlFor="wizard-api-key">
              <span>API 密钥</span>
              <input
                id="wizard-api-key"
                type="password"
                name="api_key"
                autoComplete="current-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
              />
            </label>
            {authError && (
              <p className="wizard-auth-error" role="alert">
                {authError}
              </p>
            )}
            <button className="wizard-login-submit" type="submit">
              连接并继续
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
