import { createContext } from 'react';
import type { ToolApprovalStatus } from './toolApproval';

export type ToolCallState = 'running' | 'waiting' | 'done' | 'denied' | 'expired';

/** The event ID of the message being rendered, so its tool calls can find their approval cards. */
export const ToolCallMessageContext = createContext<string | undefined>(undefined);

/**
 * What happened to each call. The public trace only says started or completed, and a denied
 * call completes without a result, so calls that needed approval take their state from the
 * approval card MindRoom posted for this reply. Cards match calls by tool name, in order.
 */
export const resolveToolCallStates = (
  calls: readonly { toolName: string; pending: boolean }[],
  approvals: readonly { toolName: string; status: ToolApprovalStatus }[]
): ToolCallState[] => {
  const unmatched = [...approvals];
  return calls.map(({ toolName, pending }) => {
    const index = unmatched.findIndex((approval) => approval.toolName === toolName);
    const status = index >= 0 ? unmatched.splice(index, 1)[0].status : undefined;
    if (status === 'denied' || status === 'expired') return status;
    if (status === 'pending' && pending) return 'waiting';
    return pending ? 'running' : 'done';
  });
};

export type ToolCallSummary = {
  state: ToolCallState;
  count: number;
  /** Tool names in call order, with repeats as "send_message ×2". */
  names: string;
};

export const summarizeToolCalls = (
  calls: readonly { toolName: string }[],
  states: readonly ToolCallState[]
): ToolCallSummary => {
  const repeats = new Map<string, number>();
  calls.forEach(({ toolName }) => repeats.set(toolName, (repeats.get(toolName) ?? 0) + 1));
  const names = [...repeats]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(', ');
  const count = (state: ToolCallState) => states.filter((item) => item === state).length;
  if (count('running') > 0) return { state: 'running', count: calls.length, names };
  if (count('waiting') > 0) return { state: 'waiting', count: count('waiting'), names };
  if (count('done') > 0) return { state: 'done', count: count('done'), names };
  return count('denied') > 0
    ? { state: 'denied', count: count('denied'), names }
    : { state: 'expired', count: count('expired'), names };
};
