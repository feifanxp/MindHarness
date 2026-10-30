export type ProjectMode = 'parallel' | 'hierarchical' | 'needs_clarification';
export type Teammate = {
  name: string;
  responsibility: string;
  behavior: string;
  recommendation: string;
  avatar_id: number | null;
  selected: boolean;
};
export type ProjectDraft = {
  draft_id: string;
  revision: number;
  status: 'proposal_ready' | 'needs_clarification';
  project: {
    name: string;
    goal: string;
    expected_outcomes: string[];
    constraints: string[];
    open_questions: string[];
  };
  collaboration: { mode: ProjectMode; rationale: string };
  agents: Teammate[];
};
export type Turn = { id: string; role: 'user' | 'assistant'; content: string };
export type WizardState = {
  draft_id: string;
  revision: number;
  status:
    | 'empty'
    | 'discovering'
    | 'proposal_ready'
    | 'revising'
    | 'confirmed'
    | 'provisioning'
    | 'created'
    | 'provision_failed';
  draft: ProjectDraft | null;
  messages: Turn[];
  pending_message_id: string | null;
  error: string | null;
  progress: string | null;
  config_installed: boolean;
  owner_user_id: string | null;
  confirmation_key: string | null;
  confirmed_revision: number | null;
  result: {
    project_id: string;
    test_mode: boolean;
    room_id: string;
    homeserver_url: string;
    team_user_id: string;
    sender_user_id: string;
    members: { agent_id: string; user_id: string; name: string; responsibility: string }[];
  } | null;
  test_mode: boolean;
};
export class WizardError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export async function wizardRequest(
  path: string,
  method = 'GET',
  body?: unknown
): Promise<WizardState | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 130_000);
  try {
    const response = await fetch(`/api/project-wizard${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new WizardError(
        response.status,
        typeof data?.detail === 'string' ? data.detail : `请求失败（${response.status}），请重试。`
      );
    if (data === null && path === '/drafts/latest') return null;
    if (
      !data ||
      typeof data.draft_id !== 'string' ||
      !Number.isInteger(data.revision) ||
      !Array.isArray(data.messages) ||
      typeof data.test_mode !== 'boolean'
    ) {
      throw new WizardError(502, '服务器返回无效草稿，请重试。');
    }
    return data as WizardState;
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError')
      throw new WizardError(504, '请求超时，已保存的内容可以重新加载。');
    if (cause instanceof TypeError && cause.message === 'Failed to fetch')
      throw new WizardError(503, '暂时无法连接讨论服务，请检查 MindRoom 服务后重试。');
    throw cause;
  } finally {
    window.clearTimeout(timer);
  }
}
