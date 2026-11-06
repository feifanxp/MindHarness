import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from 'folds';
import { discussionFetch } from './discussionSession';
import './routerDebugger.css';

export type RouterDebugSettings = {
  strategy: 'configured' | 'llm';
  model: string | null;
  prompt_template: string | null;
  history_messages: number;
  history_chars: number;
  timeout_seconds: number | null;
  retries: number;
};
export type RouterDebugSnapshot = {
  session_id: string;
  revision: number;
  settings: RouterDebugSettings;
  events: {
    sequence: number;
    timestamp: number;
    event_id: string;
    stage: string;
    detail: string;
    truncated: boolean;
  }[];
  configured: {
    model: string;
    models: string[];
    prompt_template: string;
    judgment: string | null;
    peer_discussion: boolean;
  };
};
const defaults: RouterDebugSettings = {
  strategy: 'configured',
  model: null,
  prompt_template: null,
  history_messages: 3,
  history_chars: 100,
  timeout_seconds: null,
  retries: 0,
};
const stages: Record<string, string> = {
  received: '收到消息',
  skipped: '跳过 Router',
  guidance: '返回使用说明',
  candidates: '符合条件的候选者',
  judgment: '前置判断结果',
  input: '选人输入',
  attempt: '调用模型',
  output: 'SDK 返回内容',
  validation_failed: '结果校验失败',
  selected: '选人成功',
  error: '调用失败',
  target: '目标状态',
  delivery: '转交结果',
  settings: '调试参数已应用',
};
const reasons: Record<string, string> = {
  peer_discussion: '此房间启用了平行讨论，由各 Agent 自行判断是否参与。',
  sender_not_allowed: '当前发送者不在 Router 允许的范围内。',
  router_only_mention: '只点名了 Router，返回使用说明。',
  explicit_mention: '消息已明确点名参与者，不自动选人。',
  history_unavailable: '线程历史暂不可用，本次不自动选人。',
  thread_owned_or_multi_human: '线程已有回答者，或有多个人类参与，交给线程参与规则。',
  single_responder: '仅有一个符合条件的回答者，由它自行处理。',
  no_candidates: '当前没有符合条件的回答者。',
};
function detailText(value: string): string {
  const key = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return reasons[key] ?? value;
}

function mergeSnapshot(
  previous: RouterDebugSnapshot | null,
  value: RouterDebugSnapshot
): RouterDebugSnapshot {
  if (!previous || previous.session_id !== value.session_id) return value;
  if (value.revision !== previous.revision)
    return value.revision > previous.revision ? value : previous;
  const latest = (snapshot: RouterDebugSnapshot) =>
    snapshot.events[snapshot.events.length - 1]?.sequence ?? 0;
  return latest(value) >= latest(previous) ? value : previous;
}
async function debugRequest(
  draftId: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: object
): Promise<RouterDebugSnapshot> {
  const response = await discussionFetch(
    '/api/project-wizard/drafts/' + encodeURIComponent(draftId) + '/router-debug',
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value.detail === 'string' ? value.detail : '参数或请求无效，请检查后重试。'
    );
  return value as RouterDebugSnapshot;
}

export function RouterDebugger({ draftId }: { draftId: string }) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<RouterDebugSnapshot | null>(null);
  const [draft, setDraft] = useState<RouterDebugSettings>(defaults);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const session = useRef<string | null>(null);
  const closing = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSave = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let pending: Promise<unknown>;
    const id = crypto.randomUUID();
    session.current = id;
    setSnapshot(null);
    setError(null);
    setConnected(false);
    setSaving(false);
    const poll = async (start = false) => {
      try {
        const value = await debugRequest(draftId, 'POST', { session_id: id, start });
        if (stopped) return;
        setSnapshot((previous) => mergeSnapshot(previous, value));
        if (start) setDraft(value.settings);
        setConnected(true);
        timer = setTimeout(() => {
          pending = poll();
        }, 2000);
      } catch (cause) {
        if (!stopped) {
          setConnected(false);
          setError(cause instanceof Error ? cause.message : '调试连接失败。');
        }
      }
    };
    pending = closing.current.then(() => (stopped ? undefined : poll(true)));
    return () => {
      stopped = true;
      session.current = null;
      clearTimeout(timer);
      closing.current = Promise.allSettled([pending, pendingSave.current]).then(() =>
        debugRequest(draftId, 'DELETE', { session_id: id }).catch(() => undefined)
      );
    };
  }, [draftId, open]);

  const apply = async (settings: RouterDebugSettings) => {
    const id = session.current;
    if (!id || !snapshot || !connected || pendingSave.current) return;
    setSaving(true);
    setError(null);
    const operation = debugRequest(draftId, 'PUT', {
      session_id: id,
      revision: snapshot.revision,
      settings,
    });
    pendingSave.current = operation;
    try {
      const value = await operation;
      if (session.current === id) {
        setSnapshot((previous) => mergeSnapshot(previous, value));
        setDraft(value.settings);
      }
    } catch (cause) {
      if (session.current === id)
        setError(cause instanceof Error ? cause.message : '应用失败，请重试。');
    } finally {
      pendingSave.current = null;
      if (session.current === id) setSaving(false);
    }
  };
  const changed = snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.settings);

  return (
    <aside
      className={'router-debugger' + (open ? ' router-debugger-open' : '')}
      aria-label="Router 调试器"
    >
      <div className="router-debugger-header">
        <Button
          size="300"
          fill="Soft"
          outlined
          radii="300"
          variant="Secondary"
          aria-expanded={open}
          aria-controls="router-debugger-body"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '关闭 Router 调试' : 'Router 调试'}
        </Button>
      </div>
      {open && (
        <div id="router-debugger-body" className="router-debugger-body">
          <p role="status">
            {connected ? '正在记录当前房间' : error ? '调试连接已停止' : '正在连接…'}
          </p>
          <p className="router-debugger-muted">
            仅保留打开期间最近 100
            条阶段记录。参数只影响本房间之后开始的选人请求。关闭后恢复原配置；断开超过 60
            秒自动恢复。
          </p>
          {error && (
            <p role="alert">
              {error} {!connected && '请关闭后重新打开。'}
            </p>
          )}
          {snapshot && (
            <>
              <p>
                当前房间：
                {snapshot.configured.peer_discussion ? '平行讨论，跳过 Router' : '按规则自动选人'}
                <br />
                默认模型：{snapshot.configured.model}
                <br />
                前置判断：{snapshot.configured.judgment ?? '未启用'}
              </p>
              <details className="router-debugger-settings">
                <summary>工作方式与参数{changed ? ' · 有未应用修改' : ''}</summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void apply(draft);
                  }}
                >
                  <fieldset disabled={!connected || saving}>
                    <legend>当前房间的临时设置</legend>
                    <p className="router-debugger-muted">
                      模型、提示词、历史长度、超时和重试只作用于普通 LLM
                      选人。前置判断成功时不会进入这一分支；点名和线程续接规则保持不变。
                    </p>
                    <label htmlFor={formId + '-strategy'}>
                      选人方式
                      <select
                        id={formId + '-strategy'}
                        value={draft.strategy}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            strategy: event.target.value as RouterDebugSettings['strategy'],
                          })
                        }
                      >
                        <option value="configured">使用现有策略（含已配置的前置判断）</option>
                        <option value="llm">仅使用普通 LLM 选人</option>
                      </select>
                    </label>
                    <label htmlFor={formId + '-model'}>
                      选人模型
                      <select
                        id={formId + '-model'}
                        value={draft.model ?? ''}
                        onChange={(event) =>
                          setDraft({ ...draft, model: event.target.value || null })
                        }
                      >
                        <option value="">跟随原配置／房间／线程覆盖</option>
                        {snapshot.configured.models.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label htmlFor={formId + '-count'}>
                      线程历史条数（0–20）
                      <input
                        id={formId + '-count'}
                        type="number"
                        min="0"
                        max="20"
                        step="1"
                        required
                        value={draft.history_messages}
                        onChange={(event) =>
                          setDraft({ ...draft, history_messages: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label htmlFor={formId + '-chars'}>
                      每条历史字符数（1–4000）
                      <input
                        id={formId + '-chars'}
                        type="number"
                        min="1"
                        max="4000"
                        step="1"
                        required
                        value={draft.history_chars}
                        onChange={(event) =>
                          setDraft({ ...draft, history_chars: Number(event.target.value) })
                        }
                      />
                    </label>
                    <p className="router-debugger-muted">
                      只调整已有的线程历史；主聊天仍不额外读取历史。
                    </p>
                    <label htmlFor={formId + '-timeout'}>
                      每次模型调用超时（秒，留空沿用原行为）
                      <input
                        id={formId + '-timeout'}
                        type="number"
                        min="0.1"
                        max="30"
                        step="0.1"
                        value={draft.timeout_seconds ?? ''}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            timeout_seconds: event.target.value ? Number(event.target.value) : null,
                          })
                        }
                      />
                    </label>
                    <label htmlFor={formId + '-retries'}>
                      格式／候选校验失败后额外重试（0–2 次）
                      <input
                        id={formId + '-retries'}
                        type="number"
                        min="0"
                        max="2"
                        step="1"
                        required
                        value={draft.retries}
                        onChange={(event) =>
                          setDraft({ ...draft, retries: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label htmlFor={formId + '-prompt'}>
                      选人提示词
                      <textarea
                        id={formId + '-prompt'}
                        rows={9}
                        maxLength={12000}
                        required
                        value={draft.prompt_template ?? snapshot.configured.prompt_template}
                        onChange={(event) =>
                          setDraft({ ...draft, prompt_template: event.target.value })
                        }
                      />
                    </label>
                    <p className="router-debugger-muted">
                      保留 {'{agents_info}'} 和 {'{message}'} 两个占位符。不会修改 Agent
                      自己的提示词。
                    </p>
                    <div className="router-debugger-actions">
                      <Button
                        type="submit"
                        size="300"
                        fill="Soft"
                        outlined
                        radii="300"
                        variant="Primary"
                        disabled={!changed || saving}
                      >
                        {saving ? '正在应用…' : '应用到本房间'}
                      </Button>
                      <Button
                        type="button"
                        size="300"
                        fill="Soft"
                        outlined
                        radii="300"
                        variant="Secondary"
                        onClick={() => void apply(defaults)}
                      >
                        恢复原配置
                      </Button>
                    </div>
                  </fieldset>
                </form>
              </details>
              <h3>路由过程</h3>
              <p className="router-debugger-muted">
                仅显示到达路由策略阶段的消息；入口提前过滤的事件不在此列。展开查看原始输入和返回。
              </p>
              {snapshot.events.length === 0 && (
                <p>等待新消息。可以在旁边聊天，观察本次是否触发 Router。</p>
              )}
              <ol className="router-debugger-events">
                {[...snapshot.events].reverse().map((event) => (
                  <li key={event.sequence}>
                    <details>
                      <summary>
                        <time dateTime={new Date(event.timestamp * 1000).toISOString()}>
                          {new Date(event.timestamp * 1000).toLocaleTimeString()}
                        </time>{' '}
                        {stages[event.stage] ?? event.stage}
                      </summary>
                      {event.event_id && (
                        <p className="router-debugger-event-id">消息：{event.event_id}</p>
                      )}
                      <pre>{detailText(event.detail)}</pre>
                      {event.truncated && <p>内容较长，显示已截断。</p>}
                    </details>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
