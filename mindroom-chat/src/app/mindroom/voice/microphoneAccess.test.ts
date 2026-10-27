import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMicrophoneAccessErrorMessage, requestMicrophoneAccess } from './microphoneAccess';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
  },
}));

describe('requestMicrophoneAccess', () => {
  const getUserMedia = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });

  it('opens and immediately stops a short-lived audio stream', async () => {
    const stop = vi.fn();
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [{ stop }] });

    await requestMicrophoneAccess();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('fails clearly when media capture is unsupported', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });

    await expect(requestMicrophoneAccess()).rejects.toThrow(
      'Microphone access is not supported on this device.'
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('gives iOS users actionable recovery instructions when access is denied', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    const denial = new DOMException('denied', 'NotAllowedError');
    getUserMedia.mockRejectedValueOnce(denial);

    await expect(requestMicrophoneAccess()).rejects.toMatchObject({
      message: expect.stringContaining(
        'Allow microphone access for MindRoom Chat in iPhone settings'
      ),
      cause: denial,
    });
  });

  it('maps standard media errors from another realm without relying on DOMException', () => {
    expect(
      getMicrophoneAccessErrorMessage({ name: 'NotFoundError', message: 'foreign realm error' })
    ).toBe('No microphone was found on this device.');
    expect(
      getMicrophoneAccessErrorMessage({ name: 'NotReadableError', message: 'foreign realm error' })
    ).toBe('Microphone is unavailable right now (it may be in use by another app).');
  });
});
