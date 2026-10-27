// @vitest-environment jsdom

import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './dom';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
}));

vi.mock('@capacitor/clipboard', () => ({
  Clipboard: {
    write: vi.fn(),
  },
}));

describe('copyToClipboard', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    vi.mocked(Clipboard.write).mockResolvedValue();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    vi.restoreAllMocks();
  });

  it('uses native clipboard in Capacitor apps', async () => {
    const webWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: webWrite },
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(true);

    expect(Clipboard.write).toHaveBeenCalledWith({ string: '@alice:example.org' });
    expect(webWrite).not.toHaveBeenCalled();
  });

  it('falls through to browser clipboard when native clipboard rejects', async () => {
    const webWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: webWrite },
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(Clipboard.write).mockRejectedValue(new Error('Native clipboard unavailable'));

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(true);

    expect(Clipboard.write).toHaveBeenCalledWith({ string: '@alice:example.org' });
    expect(webWrite).toHaveBeenCalledWith('@alice:example.org');
  });

  it('falls back when browser clipboard rejects and removes its temporary input', async () => {
    const webWrite = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: webWrite },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('input[data-clipboard-fallback]')).toBeNull();
  });

  it('returns the legacy copy failure when browser clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(false);

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('input[data-clipboard-fallback]')).toBeNull();
  });

  it('returns false without creating a fallback input when document.body is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const originalBody = document.body;
    const createElement = vi.spyOn(document, 'createElement');
    Object.defineProperty(document, 'body', {
      configurable: true,
      value: null,
    });

    try {
      await expect(copyToClipboard('@alice:example.org')).resolves.toBe(false);
      expect(createElement).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, 'body', {
        configurable: true,
        value: originalBody,
      });
    }
  });
});
