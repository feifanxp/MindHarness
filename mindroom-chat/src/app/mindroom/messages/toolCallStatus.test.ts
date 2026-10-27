import { describe, expect, it } from 'vitest';
import { resolveToolCallStates, summarizeToolCalls } from './toolCallStatus';

const call = (toolName: string, pending = false) => ({ toolName, pending });

describe('resolveToolCallStates', () => {
  it('reads each call from its approval card, matching repeated tools in order', () => {
    expect(
      resolveToolCallStates(
        [call('send_email', true), call('send_message', true), call('send_message', true)],
        [
          { toolName: 'send_message', status: 'denied' },
          { toolName: 'send_email', status: 'pending' },
          { toolName: 'send_message', status: 'pending' },
        ]
      )
    ).toEqual(['waiting', 'denied', 'waiting']);
  });

  it('falls back to the trace when a call needed no approval', () => {
    expect(resolveToolCallStates([call('web_search'), call('read_file', true)], [])).toEqual([
      'done',
      'running',
    ]);
  });

  it('treats a denied or expired call as not run even though the trace completed it', () => {
    expect(
      resolveToolCallStates(
        [call('run_shell_command'), call('write_file', true)],
        [
          { toolName: 'run_shell_command', status: 'denied' },
          { toolName: 'write_file', status: 'expired' },
        ]
      )
    ).toEqual(['denied', 'expired']);
  });
});

describe('summarizeToolCalls', () => {
  it('says what the group is doing, counting calls and repeated tools', () => {
    expect(
      summarizeToolCalls(
        [call('send_email'), call('send_message'), call('send_message')],
        ['waiting', 'waiting', 'waiting']
      )
    ).toEqual({ state: 'waiting', count: 3, names: 'send_email, send_message ×2' });
    expect(
      summarizeToolCalls([call('web_search'), call('read_file')], ['done', 'running'])
    ).toEqual({ state: 'running', count: 2, names: 'web_search, read_file' });
  });

  it('counts only the calls that ran, and names a group that never ran by its outcome', () => {
    expect(summarizeToolCalls([call('a'), call('b')], ['done', 'denied'])).toEqual({
      state: 'done',
      count: 1,
      names: 'a, b',
    });
    expect(summarizeToolCalls([call('run_shell_command')], ['denied'])).toEqual({
      state: 'denied',
      count: 1,
      names: 'run_shell_command',
    });
    expect(summarizeToolCalls([call('a'), call('b')], ['expired', 'expired'])).toEqual({
      state: 'expired',
      count: 2,
      names: 'a, b',
    });
  });
});
