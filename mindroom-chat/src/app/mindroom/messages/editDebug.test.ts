import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isMindroomEditDebugEnabled,
  logMindroomEditDebug,
  MINDROOM_EDIT_DEBUG_STORAGE_KEY,
} from './editDebug';

describe('editDebug', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('enables logging from the global debug flag', () => {
    vi.stubGlobal('__MINDROOM_DEBUG_EDITS__', true);

    expect(isMindroomEditDebugEnabled()).toBe(true);
  });

  it('enables logging from the localStorage debug flag', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => (key === MINDROOM_EDIT_DEBUG_STORAGE_KEY ? '1' : null)),
    } as unknown as Storage);

    expect(isMindroomEditDebugEnabled()).toBe(true);
  });

  it('logs scoped edit debug entries only when enabled', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logMindroomEditDebug('disabled', { eventId: '$event' });
    expect(infoSpy).not.toHaveBeenCalled();

    vi.stubGlobal('__MINDROOM_DEBUG_EDITS__', true);
    logMindroomEditDebug('enabled', { eventId: '$event' });

    expect(infoSpy).toHaveBeenCalledWith('[mindroom-edits:enabled]', { eventId: '$event' });
  });
});
