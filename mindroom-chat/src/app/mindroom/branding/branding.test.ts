import { describe, expect, it } from 'vitest';
import {
  MINDROOM_APP_NAME,
  MINDROOM_CHAT_SOURCE_URL,
  MINDROOM_DEFAULT_POWERED_BY,
  MINDROOM_DEVICE_DISPLAY_NAME,
  MINDROOM_DOCS_URL,
  MINDROOM_FAVICON_SRC,
  MINDROOM_NOTIFICATION_BRAND,
  MINDROOM_SOURCE_URL,
} from './branding';

describe('MindRoom branding', () => {
  it('keeps shared product labels and URLs centralized', () => {
    expect(MINDROOM_APP_NAME).toBe('MindRoom Chat');
    expect(MINDROOM_DEVICE_DISPLAY_NAME).toBe('MindRoom Chat Web');
    expect(MINDROOM_NOTIFICATION_BRAND).toBe(MINDROOM_APP_NAME);
    expect(MINDROOM_SOURCE_URL).toBe('https://github.com/mindroom-ai/mindroom');
    expect(MINDROOM_CHAT_SOURCE_URL).toBe('https://github.com/mindroom-ai/mindroom-chat');
    expect(MINDROOM_DOCS_URL).toBe('https://docs.mindroom.chat/');
  });

  it('keeps the MindRoom platform as the first default powered-by link', () => {
    expect(MINDROOM_DEFAULT_POWERED_BY[0]).toEqual({
      label: 'MindRoom',
      url: MINDROOM_SOURCE_URL,
    });
  });

  it('exports MindRoom-owned image assets from the branding boundary', () => {
    expect(MINDROOM_FAVICON_SRC).toContain('mindroom-favicon');
  });
});
