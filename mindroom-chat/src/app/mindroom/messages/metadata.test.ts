import { describe, expect, it } from 'vitest';
import { isMindroomMessageMetadataKey } from './metadata';

describe('isMindroomMessageMetadataKey', () => {
  it('recognizes MindRoom message metadata namespaces', () => {
    expect(isMindroomMessageMetadataKey('io.mindroom.ai_run')).toBe(true);
    expect(isMindroomMessageMetadataKey('io.mindroom.stream_status')).toBe(true);
    expect(isMindroomMessageMetadataKey('com.mindroom.skip_mentions')).toBe(true);
  });

  it('ignores Matrix and unrelated application metadata', () => {
    expect(isMindroomMessageMetadataKey('m.mentions')).toBe(false);
    expect(isMindroomMessageMetadataKey('io.example.key')).toBe(false);
    expect(isMindroomMessageMetadataKey('com.example.key')).toBe(false);
  });
});

