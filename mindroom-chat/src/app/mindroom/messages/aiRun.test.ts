import { describe, expect, it } from 'vitest';
import { getMindroomAiRunInfo, isMindroomAiRunStreaming } from './aiRun';

describe('getMindroomAiRunInfo', () => {
  it('extracts metadata from top-level message content', () => {
    const info = getMindroomAiRunInfo({
      'io.mindroom.ai_run': {
        version: 1,
        status: 'completed',
        run_id: 'run-1',
        session_id: 'session-1',
        model: {
          config: 'default',
          display_name: '  GPT Mini  ',
          id: 'gpt-4.1-mini',
          provider: 'openai',
        },
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          total_tokens: 125,
          cache_read_tokens: 20,
          cache_write_tokens: 5,
          time_to_first_token: 0.42,
        },
        context: {
          input_tokens: 125,
          window_tokens: 4000,
          cache_read_input_tokens: 20,
          cache_write_input_tokens: 5,
          uncached_input_tokens: 105,
        },
        tools: { count: 2 },
      },
    });

    expect(info).toEqual({
      status: 'completed',
      runId: 'run-1',
      sessionId: 'session-1',
      modelConfig: 'default',
      modelDisplayName: 'GPT Mini',
      modelId: 'gpt-4.1-mini',
      modelProvider: 'openai',
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      timeToFirstToken: 0.42,
      contextInputTokens: 125,
      contextWindowTokens: 4000,
      contextCacheReadInputTokens: 20,
      contextCacheWriteInputTokens: 5,
      contextUncachedInputTokens: 105,
      toolCount: 2,
    });
  });

  it('reads metadata from m.new_content wrapper payloads', () => {
    const info = getMindroomAiRunInfo({
      'io.mindroom.ai_run': {
        version: 1,
        model: { config: 'old', display_name: 'Old Model' },
      },
      'm.new_content': {
        body: 'edited',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'cached',
          model: { config: 'new', display_name: 'New Model' },
          usage: { total_tokens: 50 },
        },
      },
    });

    expect(info?.status).toBe('cached');
    expect(info?.totalTokens).toBe(50);
    expect(info?.modelConfig).toBe('new');
    expect(info?.modelDisplayName).toBe('New Model');
  });

  it.each([undefined, null, '', '   ', 42, {}, []])(
    'ignores missing or invalid model display name %j while preserving the alias',
    (displayName) => {
      const info = getMindroomAiRunInfo({
        'io.mindroom.ai_run': {
          version: 1,
          model: { config: 'friendly_alias', display_name: displayName },
        },
      });

      expect(info?.modelDisplayName).toBeUndefined();
      expect(info?.modelConfig).toBe('friendly_alias');
    }
  );

  it('returns undefined when metadata is absent or invalid', () => {
    expect(getMindroomAiRunInfo({})).toBeUndefined();
    expect(
      getMindroomAiRunInfo({ 'io.mindroom.ai_run': { version: 1, usage: 'bad' } })
    ).toBeUndefined();
    expect(getMindroomAiRunInfo({ 'io.mindroom.ai_run': { version: 3 } })).toBeUndefined();
  });
});

describe('isMindroomAiRunStreaming', () => {
  it('returns false when no ai_run metadata is present', () => {
    expect(isMindroomAiRunStreaming({})).toBe(false);
    expect(isMindroomAiRunStreaming({ 'io.mindroom.ai_run': { version: 2 } })).toBe(false);
  });

  it('returns false for terminal statuses', () => {
    const terminalStatuses = ['completed', 'cached', 'error', 'cancelled'];
    for (const status of terminalStatuses) {
      expect(isMindroomAiRunStreaming({ 'io.mindroom.ai_run': { version: 1, status } })).toBe(
        false
      );
    }
  });

  it('returns true for non-terminal statuses', () => {
    const activeStatuses = ['streaming', 'running', 'active', 'thinking'];
    for (const status of activeStatuses) {
      expect(isMindroomAiRunStreaming({ 'io.mindroom.ai_run': { version: 1, status } })).toBe(true);
    }
  });

  it('returns true when metadata exists but status is absent', () => {
    expect(isMindroomAiRunStreaming({ 'io.mindroom.ai_run': { version: 1 } })).toBe(true);
  });

  it('reads metadata from m.new_content wrapper', () => {
    expect(
      isMindroomAiRunStreaming({
        'm.new_content': {
          body: 'partial',
          'io.mindroom.ai_run': { version: 1, status: 'running' },
        },
      })
    ).toBe(true);

    expect(
      isMindroomAiRunStreaming({
        'm.new_content': {
          body: 'done',
          'io.mindroom.ai_run': { version: 1, status: 'completed' },
        },
      })
    ).toBe(false);
  });

  it('returns true when io.mindroom.stream_status is active (no ai_run metadata)', () => {
    const activeStatuses = ['pending', 'streaming', 'running', 'active'];
    for (const status of activeStatuses) {
      expect(isMindroomAiRunStreaming({ 'io.mindroom.stream_status': status })).toBe(true);
    }
  });

  it('returns false when io.mindroom.stream_status is terminal (no ai_run metadata)', () => {
    const terminalStatuses = [
      'completed',
      'complete',
      'done',
      'error',
      'failed',
      'stopped',
      'cancelled',
    ];
    for (const status of terminalStatuses) {
      expect(isMindroomAiRunStreaming({ 'io.mindroom.stream_status': status })).toBe(false);
    }
  });

  it('returns false when io.mindroom.stream_status is unrecognized (no ai_run metadata)', () => {
    expect(isMindroomAiRunStreaming({ 'io.mindroom.stream_status': 'unknown' })).toBe(false);
  });

  it('reads stream_status from m.new_content wrapper', () => {
    expect(
      isMindroomAiRunStreaming({
        'm.new_content': {
          body: 'partial response',
          'io.mindroom.stream_status': 'streaming',
        },
      })
    ).toBe(true);

    expect(
      isMindroomAiRunStreaming({
        'm.new_content': {
          body: 'final response',
          'io.mindroom.stream_status': 'completed',
        },
      })
    ).toBe(false);
  });

  it('is case-insensitive for stream_status', () => {
    expect(isMindroomAiRunStreaming({ 'io.mindroom.stream_status': 'STREAMING' })).toBe(true);
    expect(isMindroomAiRunStreaming({ 'io.mindroom.stream_status': 'Completed' })).toBe(false);
  });

  it('prefers ai_run metadata over stream_status when both present', () => {
    // ai_run says completed, stream_status says streaming → not streaming (ai_run wins)
    expect(
      isMindroomAiRunStreaming({
        'io.mindroom.ai_run': { version: 1, status: 'completed' },
        'io.mindroom.stream_status': 'streaming',
      })
    ).toBe(false);

    // ai_run says running, stream_status says completed → streaming (ai_run wins)
    expect(
      isMindroomAiRunStreaming({
        'io.mindroom.ai_run': { version: 1, status: 'running' },
        'io.mindroom.stream_status': 'completed',
      })
    ).toBe(true);
  });
});
