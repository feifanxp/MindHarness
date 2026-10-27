import { Capacitor, registerPlugin } from '@capacitor/core';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativePlugin = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => nativePlugin),
}));

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const readSwiftEventNames = (): string[] => {
  const source = readFileSync(
    new URL('../../../../ios/App/App/MindRoomDiagnosticsStore.swift', import.meta.url),
    'utf8'
  );
  const enumBody = source.match(
    /enum MindRoomDiagnosticEventName: String, Codable \{([\s\S]*?)\n\}/
  )?.[1];
  if (!enumBody) throw new Error('MindRoomDiagnosticEventName enum was not found');

  const declarations = [...enumBody.matchAll(/^\s*case\s+\w+(?:\s*=\s*"([^"]+)")?\s*$/gm)];
  if (declarations.length === 0 || declarations.some((declaration) => !declaration[1])) {
    throw new Error('MindRoomDiagnosticEventName must use fixed string raw values');
  }
  return declarations.map((declaration) => declaration[1] as string);
};

const readDiagnostics = async () => {
  const diagnostics = await import('./nativeDiagnostics');
  return diagnostics.readNativeDiagnostics();
};

describe('native diagnostics reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  });

  it('reports unsupported without registering or invoking a plugin on web', async () => {
    await expect(readDiagnostics()).resolves.toEqual({
      schemaVersion: 1,
      status: 'unsupported',
      currentSessionId: null,
      events: [],
      droppedEventCount: 0,
    });

    expect(registerPlugin).not.toHaveBeenCalled();
    expect(nativePlugin.read).not.toHaveBeenCalled();
  });

  it('reports unsupported on an old native build without the plugin', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    await expect(readDiagnostics()).resolves.toMatchObject({ status: 'unsupported', events: [] });

    expect(registerPlugin).not.toHaveBeenCalled();
    expect(nativePlugin.read).not.toHaveBeenCalled();
  });

  it('sanitizes a valid native snapshot at the JavaScript boundary', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockResolvedValue({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: sessionId,
      events: [
        {
          at: 100,
          monotonicMs: 12.5,
          sequence: 2,
          sessionId,
          name: 'navigation.failed',
          url: 'https://secret.example/room/abc',
          data: {
            loading: false,
            progress: 0.5,
            errorDomain: 'webkit',
            errorCode: 102,
            description: 'secret query=token',
          },
        },
      ],
      droppedEventCount: 3,
      storagePath: '/private/secret',
    });

    await expect(readDiagnostics()).resolves.toEqual({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: sessionId,
      events: [
        {
          at: 100,
          monotonicMs: 12.5,
          sequence: 2,
          sessionId,
          name: 'navigation.failed',
          data: {
            loading: false,
            progress: 0.5,
            errorDomain: 'webkit',
            errorCode: 102,
          },
        },
      ],
      droppedEventCount: 3,
    });
  });

  it('accepts every event name declared by the Swift diagnostics store', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    const swiftEventNames = readSwiftEventNames();
    nativePlugin.read.mockResolvedValue({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: sessionId,
      events: swiftEventNames.map((name, sequence) => ({
        at: sequence,
        monotonicMs: sequence,
        sequence,
        sessionId,
        name,
      })),
      droppedEventCount: 0,
    });

    const snapshot = await readDiagnostics();

    expect(snapshot.status).toBe('available');
    expect(snapshot.events.map((event) => event.name)).toEqual(swiftEventNames);
  });

  it('reports invalid for malformed native output', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockResolvedValue({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: 'not-a-uuid',
      events: [],
      droppedEventCount: 0,
    });

    await expect(readDiagnostics()).resolves.toMatchObject({
      status: 'invalid',
      currentSessionId: null,
      events: [],
    });
  });

  it('reports unavailable when the native call rejects', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockRejectedValue(new Error('native secret'));

    await expect(readDiagnostics()).resolves.toMatchObject({
      status: 'unavailable',
      currentSessionId: null,
      events: [],
    });
  });

  it('keeps the newest 128 safe events and accounts for JavaScript-side drops', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockResolvedValue({
      schemaVersion: 1,
      status: 'corrupt',
      currentSessionId: sessionId,
      events: Array.from({ length: 130 }, (_, index) => ({
        at: index,
        monotonicMs: index,
        sequence: index,
        sessionId,
        name: 'scene.active',
      })),
      droppedEventCount: 1,
    });

    const snapshot = await readDiagnostics();

    expect(snapshot.status).toBe('corrupt');
    expect(snapshot.events).toHaveLength(128);
    expect(snapshot.events[0]?.sequence).toBe(2);
    expect(snapshot.events[127]?.sequence).toBe(129);
    expect(snapshot.droppedEventCount).toBe(3);
  });
});
