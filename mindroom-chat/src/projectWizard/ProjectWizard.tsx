import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
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
import './projectWizard.css';

const examples = ['讨论一个新产品方向', '组建团队完成市场调研', '一起策划一场社区活动'];
const modeLabels: Record<ProjectMode, string> = {
  parallel: '平行讨论',
  hierarchical: '主从执行',
  needs_clarification: '还需澄清',
};

export default function ProjectWizard() {
  const [saved, setSaved] = useState<WizardState | null>(null);
  const current = useRef<WizardState | null>(null);
  const initialDraftId = useRef(new URLSearchParams(window.location.search).get('draft'));
  const initialDraftPath = initialDraftId.current
    ? '/drafts/' + encodeURIComponent(initialDraftId.current)
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
  const [confirmation, setConfirmation] = useState<WizardState | null>(null);
  const confirmationKey = useRef<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const retryAction = useRef<(() => Promise<void>) | null>(null);
  const messages = saved?.messages ?? [];
  const projectDraft = saved?.draft ?? null;
  const serverBusy =
    !!saved &&
    !saved.error &&
    (!!saved.pending_message_id || ['confirmed', 'provisioning'].includes(saved.status));
  const frozen =
    !!saved && ['confirmed', 'provisioning', 'created', 'provision_failed'].includes(saved.status);
  const disabled = loading || pending || serverBusy || frozen || !!saved?.pending_message_id;

  const accept = useCallback((value: WizardState | null) => {
    if (!alive.current) return;
    current.current = value;
    setSaved(value);
    setProjectName(value?.draft?.project.name ?? '');
    if (value) {
      const url = new URL(window.location.href);
      url.searchParams.set('draft', value.draft_id);
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);
  const report = useCallback((cause: unknown) => {
    if (cause instanceof WizardError && cause.status === 401) setAuthRequired(true);
    else setError(cause instanceof Error ? cause.message : '连接失败，请重试。');
  }, []);
  const restore = useCallback(async () => {
    if (busy.current) return;
    const before = current.current;
    try {
      const value = await wizardRequest(
        current.current ? `/drafts/${current.current.draft_id}` : initialDraftPath
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
    void wizardRequest(initialDraftPath)
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
    setError('');
    retryAction.current = action;
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
            setConfirmation(null);
            confirmationKey.current = null;
            retryAction.current = null;
            setError('');
            return;
          }
        } catch {
          /* Keep the last saved snapshot visible during a connection failure. */
        }
      }
      if (cause instanceof WizardError && cause.status === 409) {
        setConfirmation(null);
        confirmationKey.current = null;
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
      if (!created) throw new Error('无法创建新草稿，请重试。');
      accept(created);
      setDraft('');
      setConfirmation(null);
      confirmationKey.current = null;
      setMobilePlanOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  };
  const send = async (content: string, messageId: string) => {
    let state = current.current;
    if (!state) {
      state = await wizardRequest('/drafts', 'POST');
      if (!state) throw new Error('无法建立草稿，请重试。');
      accept(state);
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
    if (!content || disabled || busy.current || authRequired || confirmation || error) return;
    const id = crypto.randomUUID();
    void run(() => send(content, id));
  };
  const retry = () => {
    const state = current.current;
    if (state?.pending_message_id && state.error) {
      const message = state.messages.find((item) => item.id === state.pending_message_id);
      if (message) void run(() => send(message.content, message.id));
    } else if (retryAction.current) void run(retryAction.current);
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
  const confirm = (state: WizardState, key: string) =>
    run(async () => {
      accept(
        await wizardRequest(`/drafts/${state.draft_id}/confirm`, 'POST', {
          revision: state.confirmed_revision ?? state.revision,
          idempotency_key: key,
        })
      );
      setConfirmation(null);
    }, key);
  const startChat = async () => {
    const state = current.current;
    if (!state?.result || state.result.test_mode || !state.owner_user_id) return;
    await run(async () => {
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
        if (!response.ok)
          throw new Error(
            typeof session.detail === 'string' ? session.detail : '聊天登录失败，请重试。'
          );
        if (
          session.user_id !== state.owner_user_id ||
          session.room_id !== result.room_id ||
          normalizeSessionBaseUrl(session.base_url) !==
            normalizeSessionBaseUrl(result.homeserver_url) ||
          typeof session.access_token !== 'string' ||
          typeof session.device_id !== 'string'
        ) {
          throw new Error('聊天登录身份不匹配，请重新加载项目。');
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
      window.location.assign(`/chat.html#/home/${encodeURIComponent(result.room_id)}`);
    });
  };

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
          aria-label="描述你的项目想法"
          aria-describedby="wizard-composer-hint"
          name="message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="描述你想做的项目…"
          rows={1}
          maxLength={4000}
          disabled={disabled || authRequired || !!confirmation || !!error}
        />
        <button
          className="wizard-send"
          type="submit"
          disabled={!draft.trim() || disabled || authRequired || !!confirmation || !!error}
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
        <a className="wizard-brand" href="/" aria-label="Agent Room 首页">
          <span className="wizard-mark">
            <IconSparkles size={18} />
          </span>
          <span>Agent Room</span>
          <span className="wizard-slash">/</span>
          <span className="wizard-label">创建项目</span>
        </a>
        <nav className="wizard-header-actions" aria-label="项目操作">
          <a className="wizard-chat-link" href="/chat.html">
            聊天室
          </a>
          <button
            className="wizard-new-project"
            type="button"
            disabled={loading || pending || serverBusy || authRequired || !saved}
            onClick={newProject}
            title="新建独立草稿，已有项目和聊天室会保留"
          >
            新建项目
          </button>
        </nav>
      </header>

      <section className={`wizard-content ${messages.length ? 'wizard-content-chat' : ''}`}>
        {!messages.length ? (
          <>
            <div className="wizard-welcome">
              <span className="wizard-eyebrow">从一个想法开始</span>
              <h1>你想创建一个什么样的项目？</h1>
              {loading && <p role="status">正在恢复草稿…</p>}
              <p>说说你想解决的问题，我们一起梳理目标、预期产出和合适的协作方式。</p>
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
              <div className="wizard-thread" role="log" aria-live="polite">
                {messages.map((message) => (
                  <article className={`wizard-message wizard-${message.role}`} key={message.id}>
                    <span className="wizard-message-role">
                      {message.role === 'user' ? '你' : '项目助手'}
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
                    {confirmation || saved?.status === 'provisioning'
                      ? '正在创建聊天室和 Bot…'
                      : '项目助手正在整理你的想法…'}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {composer}
            </div>

            {projectDraft && (
              <button
                className="wizard-plan-mobile-toggle"
                type="button"
                aria-expanded={mobilePlanOpen}
                aria-controls="wizard-plan-panel"
                onClick={() => setMobilePlanOpen(!mobilePlanOpen)}
              >
                {mobilePlanOpen ? '收起项目方案' : `查看项目方案 · v${projectDraft.revision}`}
              </button>
            )}

            {projectDraft && (
              <aside
                id="wizard-plan-panel"
                className={`wizard-plan-panel ${mobilePlanOpen ? 'wizard-plan-panel-open' : ''}`}
                aria-label="项目方案预览"
              >
                <div className="wizard-plan-heading">
                  <h2>项目方案</h2>
                  <span>v{projectDraft.revision}</span>
                </div>
                {projectDraft.status === 'needs_clarification' && (
                  <p className="wizard-plan-status">继续补充信息，方案会随对话更新。</p>
                )}
                {!frozen && (
                  <button
                    className="wizard-confirm"
                    type="button"
                    disabled={
                      disabled ||
                      !!error ||
                      projectDraft.status !== 'proposal_ready' ||
                      projectName.trim() !== projectDraft.project.name
                    }
                    onClick={() => {
                      setConfirmation(saved);
                      confirmationKey.current = crypto.randomUUID();
                    }}
                  >
                    确认创建
                  </button>
                )}
                {confirmation?.draft && (
                  <section className="wizard-confirm-summary" aria-label="确认摘要">
                    <h3>确认创建</h3>
                    <p>{confirmation.draft.project.name}</p>
                    <p>{confirmation.draft.project.goal}</p>
                    <p>
                      {modeLabels[confirmation.draft.collaboration.mode]} ·{' '}
                      {confirmation.draft.agents.length} 位拟定成员
                    </p>
                    <ul>
                      {confirmation.draft.agents.map((agent) => (
                        <li key={agent.name}>{agent.name}</li>
                      ))}
                    </ul>
                    <p>会创建真实聊天室并配置 Bot；不会为 Bot 自动授予额外工具权限。</p>
                    <button type="button" disabled={pending} onClick={() => setConfirmation(null)}>
                      返回修改
                    </button>
                    <button
                      type="button"
                      className="wizard-confirm"
                      disabled={pending}
                      onClick={() => {
                        if (confirmationKey.current)
                          void confirm(confirmation, confirmationKey.current);
                      }}
                    >
                      {pending ? '正在创建聊天室…' : '确认创建聊天室'}
                    </button>
                  </section>
                )}
                {saved?.status === 'provision_failed' && (
                  <section className="wizard-confirm-summary" role="alert">
                    <h3>创建失败</h3>
                    <p>{saved.error}</p>
                    <p>
                      {saved.config_installed
                        ? '配置已保存，部分 Bot 可能尚未上线。请先重试创建。'
                        : '配置尚未完成，真实聊天室或 Bot 可能未建立。请查看错误后重试。'}
                    </p>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (saved.confirmation_key) void confirm(saved, saved.confirmation_key);
                      }}
                    >
                      重试创建
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
                      返回修改方案
                    </button>
                  </section>
                )}
                {saved?.result && (
                  <section className="wizard-confirm-summary" role="status">
                    <h3>聊天室已创建</h3>
                    <p>聊天室和 Bot 已创建并完成加入。</p>
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
                  项目名称
                  <input
                    id="wizard-project-name"
                    name="project_name"
                    maxLength={120}
                    value={projectName}
                    disabled={disabled || !!confirmation}
                    onChange={(event) => setProjectName(event.target.value)}
                    onBlur={() => {
                      void rename();
                    }}
                  />
                </label>
                <section className="wizard-plan-section">
                  <h3>项目目标</h3>
                  <p>{projectDraft.project.goal}</p>
                </section>
                <section className="wizard-plan-section">
                  <h3>预期成果</h3>
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
                <section className="wizard-plan-section">
                  <h3>Agent 成员 · {projectDraft.agents.length}</h3>
                  <div className="wizard-plan-agents">
                    {projectDraft.agents.map((agent) => (
                      <details key={agent.name}>
                        <summary>
                          <strong>{agent.name}</strong>
                          <span>{agent.responsibility}</span>
                        </summary>
                        <p className="wizard-agent-behavior">{agent.behavior}</p>
                      </details>
                    ))}
                  </div>
                </section>
                {!!projectDraft.project.constraints.length && (
                  <section className="wizard-plan-section">
                    <h3>主要约束</h3>
                    <ul>
                      {projectDraft.project.constraints.map((constraint) => (
                        <li key={constraint}>{constraint}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {!!projectDraft.project.open_questions.length && (
                  <section className="wizard-plan-section">
                    <h3>待确认</h3>
                    <ul>
                      {projectDraft.project.open_questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <p className="wizard-plan-edit-hint">
                  这是团队组织方式建议，尚未启用自动发言或任务调度。
                </p>
                <button
                  type="button"
                  className="wizard-plan-edit"
                  disabled={disabled || !!confirmation}
                  onClick={() => {
                    setMobilePlanOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  修改方案
                </button>
                <p className="wizard-plan-edit-hint">确认后会创建真实聊天室和 Bot。</p>
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
