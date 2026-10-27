import { describe, expect, it } from 'vitest';
import {
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  getMindroomAiRunCompactModelLabel,
  getMindroomAiRunContextBarSegments,
  getMindroomAiRunContextCacheLabel,
  getMindroomAiRunContextLabel,
  getMindroomAiRunUsageCacheLabel,
  getMindroomAiRunModelLabel,
  getMindroomAiRunUsageLabel,
} from './aiRunDisplay';

describe('getMindroomAiRunModelLabel', () => {
  it('combines config, provider, and model id when present', () => {
    expect(
      getMindroomAiRunModelLabel({
        modelConfig: 'default',
        modelProvider: 'openai',
        modelId: 'gpt-4.1-mini',
      })
    ).toBe('default (openai / gpt-4.1-mini)');
  });

  it('falls back cleanly when only partial model information exists', () => {
    expect(getMindroomAiRunModelLabel({ modelConfig: 'default' })).toBe('default');
    expect(
      getMindroomAiRunModelLabel({
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet',
      })
    ).toBe('anthropic / claude-sonnet');
  });
});

describe('getMindroomAiRunCompactModelLabel', () => {
  it.each(['custom_alias', 'default', undefined])(
    'prefers the display name over config %s and preserves its casing',
    (modelConfig) => {
      expect(
        getMindroomAiRunCompactModelLabel({
          modelDisplayName: 'my Friendly Model',
          modelConfig,
          modelId: 'another-model',
          modelProvider: 'openai',
        })
      ).toBe('my Friendly Model');
    }
  );

  it('prefers a friendly configured model name', () => {
    expect(
      getMindroomAiRunCompactModelLabel({
        modelConfig: 'opus',
        modelProvider: 'anthropic',
        modelId: 'claude-opus-4-6',
      })
    ).toBe('Opus');
    expect(getMindroomAiRunCompactModelLabel({ modelConfig: 'bedtime_fable' })).toBe(
      'Bedtime Fable'
    );
  });

  it('uses a concise model id when the config name is generic', () => {
    expect(
      getMindroomAiRunCompactModelLabel({
        modelConfig: 'default',
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      })
    ).toBe('Sonnet 4.6');
    expect(getMindroomAiRunCompactModelLabel({ modelProvider: 'openai', modelId: 'gpt-5.4' })).toBe(
      'GPT-5.4'
    );
  });

  it('drops latest aliases with and without a version number', () => {
    expect(
      getMindroomAiRunCompactModelLabel({
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-latest',
      })
    ).toBe('Sonnet');
    expect(
      getMindroomAiRunCompactModelLabel({
        modelProvider: 'anthropic',
        modelId: 'claude-opus-4-latest',
      })
    ).toBe('Opus 4');
  });
});

describe('getMindroomAiRunUsageLabel', () => {
  it('formats token counts in a compact summary', () => {
    expect(
      getMindroomAiRunUsageLabel({
        inputTokens: 1024,
        outputTokens: 256,
        totalTokens: 1280,
      })
    ).toBe('in 1,024 • out 256 • total 1,280');
  });

  it('returns undefined when no usage values are present', () => {
    expect(getMindroomAiRunUsageLabel({})).toBeUndefined();
  });
});

describe('getMindroomAiRunUsageCacheLabel', () => {
  it('formats cumulative run cache counters separately from token totals', () => {
    expect(
      getMindroomAiRunUsageCacheLabel({
        cacheReadTokens: 20000,
        cacheWriteTokens: 500,
      })
    ).toBe('read 20,000 • write 500');
  });

  it('returns undefined when no cumulative cache counters are present', () => {
    expect(getMindroomAiRunUsageCacheLabel({})).toBeUndefined();
  });
});

describe('getMindroomAiRunContextLabel', () => {
  it('formats context usage with a percentage', () => {
    expect(
      getMindroomAiRunContextLabel({
        contextInputTokens: 500,
        contextWindowTokens: 2000,
      })
    ).toBe('500 / 2,000 (25.0%)');
  });

  it('returns undefined for incomplete or invalid context values', () => {
    expect(getMindroomAiRunContextLabel({ contextInputTokens: 10 })).toBeUndefined();
    expect(
      getMindroomAiRunContextLabel({
        contextInputTokens: 10,
        contextWindowTokens: 0,
      })
    ).toBeUndefined();
  });
});

describe('getMindroomAiRunContextCacheLabel', () => {
  it('formats latest-request cache and non-cache-read context counters', () => {
    expect(
      getMindroomAiRunContextCacheLabel({
        contextCacheReadInputTokens: 9000,
        contextCacheWriteInputTokens: 10,
        contextUncachedInputTokens: 130,
      })
    ).toBe('read 9,000 • write 10 • not read 130');
  });

  it('returns undefined when no latest-request cache counters are present', () => {
    expect(getMindroomAiRunContextCacheLabel({})).toBeUndefined();
  });
});

describe('getMindroomAiRunContextBarSegments', () => {
  it('maps latest-request cache, new input, and reserve to context-window bar segments', () => {
    expect(
      getMindroomAiRunContextBarSegments({
        contextInputTokens: 65,
        contextWindowTokens: 100,
        contextCacheReadInputTokens: 20,
        contextCacheWriteInputTokens: 5,
        contextUncachedInputTokens: 45,
      })
    ).toEqual([
      {
        key: 'cacheRead',
        label: 'Cache read',
        tokens: 20,
        percentage: 20,
        title: 'Cache read: 20 tokens (20.0% of window)',
      },
      {
        key: 'newInput',
        label: 'New input',
        tokens: 45,
        percentage: 45,
        title: 'New input: 45 tokens (45.0% of window); cache write: 5 tokens',
      },
      {
        key: 'reserve',
        label: 'Reserve',
        tokens: 35,
        percentage: 35,
        title: 'Reserve: 35 tokens (35.0% of window)',
      },
    ]);
  });

  it('returns undefined when required context-window values are missing or inconsistent', () => {
    expect(getMindroomAiRunContextBarSegments({ contextInputTokens: 65 })).toBeUndefined();
    expect(
      getMindroomAiRunContextBarSegments({
        contextInputTokens: 120,
        contextWindowTokens: 100,
        contextCacheReadInputTokens: 20,
        contextUncachedInputTokens: 100,
      })
    ).toBeUndefined();
  });

  it('still renders malformed cache-read metadata by clipping it to the displayed context', () => {
    const segments = getMindroomAiRunContextBarSegments({
      contextInputTokens: 153294,
      contextWindowTokens: 200000,
      contextCacheReadInputTokens: 281264,
    });

    expect(segments).toEqual([
      expect.objectContaining({
        key: 'cacheRead',
        label: 'Cache read',
        tokens: 153294,
        title: 'Cache read: 153,294 tokens (76.6% of window); reported cache read: 281,264 tokens',
      }),
      expect.objectContaining({
        key: 'newInput',
        label: 'New input',
        tokens: 0,
        percentage: 0,
        title: 'New input: 0 tokens (0.0% of window)',
      }),
      expect.objectContaining({
        key: 'reserve',
        label: 'Reserve',
        tokens: 46706,
        title: 'Reserve: 46,706 tokens (23.4% of window)',
      }),
    ]);
    expect(segments?.[0]?.percentage).toBeCloseTo(76.647);
    expect(segments?.[2]?.percentage).toBeCloseTo(23.353);
  });

  it('renders a context usage bar even when cache counters are absent', () => {
    expect(
      getMindroomAiRunContextBarSegments({
        contextInputTokens: 65,
        contextWindowTokens: 100,
      })
    ).toEqual([
      {
        key: 'cacheRead',
        label: 'Cache read',
        tokens: 0,
        percentage: 0,
        title: 'Cache read: 0 tokens (0.0% of window)',
      },
      {
        key: 'newInput',
        label: 'New input',
        tokens: 65,
        percentage: 65,
        title: 'New input: 65 tokens (65.0% of window)',
      },
      {
        key: 'reserve',
        label: 'Reserve',
        tokens: 35,
        percentage: 35,
        title: 'Reserve: 35 tokens (35.0% of window)',
      },
    ]);
  });

  it('omits invalid cache-write counts from the new-input segment title', () => {
    const segments = getMindroomAiRunContextBarSegments({
      contextInputTokens: 65,
      contextWindowTokens: 100,
      contextCacheReadInputTokens: 20,
      contextCacheWriteInputTokens: -5,
      contextUncachedInputTokens: 45,
    });

    expect(segments?.find((segment) => segment.key === 'newInput')?.title).toBe(
      'New input: 45 tokens (45.0% of window)'
    );
  });
});

describe('formatMindroomAiRunTimeToFirstToken', () => {
  it('formats positive values in milliseconds', () => {
    expect(formatMindroomAiRunTimeToFirstToken(0.42)).toBe('420 ms');
  });

  it('returns undefined for invalid ttft values', () => {
    expect(formatMindroomAiRunTimeToFirstToken(undefined)).toBeUndefined();
    expect(formatMindroomAiRunTimeToFirstToken(-1)).toBeUndefined();
  });
});

describe('formatMindroomAiRunNumber', () => {
  it('formats numbers with grouping separators', () => {
    expect(formatMindroomAiRunNumber(12345)).toBe('12,345');
  });
});
