import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildFlightRecorderPayload: vi.fn(),
  getDeepTraceEnabled: vi.fn(),
  getDeepTraceHealthSnapshot: vi.fn(),
  readNativeDiagnostics: vi.fn(),
  readDeepTraceSnapshot: vi.fn(),
  readDeepTraceMemorySnapshot: vi.fn(),
}));

vi.mock('./flightRecorder', () => ({
  FLIGHT_RECORDER_SCHEMA_VERSION: 1,
  buildFlightRecorderPayload: mocks.buildFlightRecorderPayload,
  normalizeFlightRecorderBuildVersion: (value: string) => value,
}));

vi.mock('./deepTrace', () => ({
  DEEP_TRACE_SCHEMA_VERSION: 1,
  getDeepTraceEnabled: mocks.getDeepTraceEnabled,
  getDeepTraceHealthSnapshot: mocks.getDeepTraceHealthSnapshot,
  readDeepTraceSnapshot: mocks.readDeepTraceSnapshot,
  readDeepTraceMemorySnapshot: mocks.readDeepTraceMemorySnapshot,
}));

vi.mock('./nativeDiagnostics', () => ({
  NATIVE_DIAGNOSTICS_SCHEMA_VERSION: 1,
  createEmptyNativeDiagnosticsSnapshot: (status: string) => ({
    schemaVersion: 1,
    status,
    currentSessionId: null,
    events: [],
    droppedEventCount: 0,
  }),
  readNativeDiagnostics: mocks.readNativeDiagnostics,
}));

import {
  DIAGNOSTICS_EXPORT_SCHEMA_VERSION,
  buildDiagnosticsExport,
  buildDiagnosticsPayload,
} from './diagnosticsExport';

describe('combined diagnostics export', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_784_513_628_415);
    mocks.buildFlightRecorderPayload.mockReturnValue({
      metadata: {
        exportSchemaVersion: 1,
        flightRecorderSchemaVersion: 1,
        buildVersion: 'build-sha',
        exportedAt: 1,
      },
      abnormalSession: { sessionId: 'abnormal' },
      currentOrPreservedSession: { sessionId: 'current' },
    });
    mocks.readDeepTraceSnapshot.mockResolvedValue({
      schemaVersion: 1,
      enabled: true,
      status: 'recording',
      stats: {
        eventCount: 1,
        byteCount: 100,
        droppedEventCount: 0,
        oldestAt: 10,
        newestAt: 10,
      },
      events: [{ name: 'thread_resume.visibility.start' }],
    });
    mocks.getDeepTraceEnabled.mockReturnValue(false);
    mocks.readDeepTraceMemorySnapshot.mockReturnValue({ storage: 'memory', events: [] });
    mocks.getDeepTraceHealthSnapshot.mockReturnValue({
      status: 'recording',
      pendingEventCount: 0,
      pendingBytes: 0,
      flushing: false,
      lastFailure: null,
    });
    mocks.readNativeDiagnostics.mockResolvedValue({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      events: [
        {
          at: 1_784_513_600_000,
          monotonicMs: 120.5,
          sequence: 1,
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'app.launch',
        },
      ],
      droppedEventCount: 0,
    });
  });

  it('exports flight evidence and the retained deep trace under a versioned envelope', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { blob, fileName } = await buildDiagnosticsExport();
    const payload = JSON.parse(await blob.text());

    expect(fileName).toBe('mindroom-diagnostics-2026-07-20T02-13-48-415Z.json');
    expect(payload.metadata).toEqual({
      exportSchemaVersion: 4,
      flightRecorderSchemaVersion: 1,
      deepTraceSchemaVersion: 1,
      nativeDiagnosticsSchemaVersion: 1,
      buildVersion: 'build-sha',
      exportedAt: 1_784_513_628_415,
    });
    expect(payload.abnormalSession).toEqual({ sessionId: 'abnormal' });
    expect(payload.currentOrPreservedSession).toEqual({ sessionId: 'current' });
    expect(payload.flightRecorderStatus).toBe('available');
    expect(payload.deepTrace).toMatchObject({
      enabled: true,
      status: 'recording',
      events: [{ name: 'thread_resume.visibility.start' }],
    });
    expect(payload.deepTraceHealth).toEqual({
      status: 'recording',
      pendingEventCount: 0,
      pendingBytes: 0,
      flushing: false,
      lastFailure: null,
    });
    expect(payload.nativeDiagnostics).toMatchObject({
      status: 'available',
      events: [{ name: 'app.launch' }],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still exports the flight record when deep trace storage is unavailable', async () => {
    let health = {
      status: 'recording',
      pendingEventCount: 1,
      pendingBytes: 100,
      flushing: false,
      lastFailure: null as null | { at: number; stage: string; errorName: string },
    };
    mocks.getDeepTraceHealthSnapshot.mockImplementation(() => health);
    mocks.readDeepTraceSnapshot.mockImplementation(async () => {
      health = {
        status: 'unavailable',
        pendingEventCount: 0,
        pendingBytes: 0,
        flushing: false,
        lastFailure: {
          at: 1_784_513_628_415,
          stage: 'flush',
          errorName: 'InvalidStateError',
        },
      };
      throw new Error('IndexedDB blocked');
    });
    mocks.getDeepTraceEnabled.mockReturnValue(true);

    const payload = JSON.parse(await (await buildDiagnosticsExport()).blob.text());

    expect(payload.abnormalSession).toEqual({ sessionId: 'abnormal' });
    expect(payload.deepTrace).toEqual({
      schemaVersion: 1,
      enabled: true,
      status: 'unavailable',
      stats: {
        eventCount: 0,
        byteCount: 0,
        droppedEventCount: 0,
        oldestAt: null,
        newestAt: null,
      },
      events: [],
    });
    expect(payload.deepTraceHealth).toEqual({
      status: 'unavailable',
      pendingEventCount: 0,
      pendingBytes: 0,
      flushing: false,
      lastFailure: {
        at: 1_784_513_628_415,
        stage: 'flush',
        errorName: 'InvalidStateError',
      },
    });
  });

  it('still exports a healthy deep trace when flight-recorder storage is unavailable', async () => {
    mocks.buildFlightRecorderPayload.mockImplementation(() => {
      throw new Error('localStorage blocked');
    });

    const payload = JSON.parse(await (await buildDiagnosticsExport()).blob.text());

    expect(payload.flightRecorderStatus).toBe('unavailable');
    expect(payload.abnormalSession).toBeNull();
    expect(payload.currentOrPreservedSession).toBeNull();
    expect(payload.deepTrace).toMatchObject({
      status: 'recording',
      events: [{ name: 'thread_resume.visibility.start' }],
    });
  });

  it.each([
    ['unsupported', 'unsupported'],
    ['rejected', 'unavailable'],
  ])('retains other evidence when native diagnostics are %s', async (mode, expectedStatus) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    if (mode === 'unsupported') {
      mocks.readNativeDiagnostics.mockResolvedValue({
        schemaVersion: 1,
        status: 'unsupported',
        currentSessionId: null,
        events: [],
        droppedEventCount: 0,
      });
    } else {
      mocks.readNativeDiagnostics.mockRejectedValue(new Error('native read rejected'));
    }

    const payload = JSON.parse(await (await buildDiagnosticsExport()).blob.text());

    expect(payload.nativeDiagnostics).toMatchObject({ status: expectedStatus, events: [] });
    expect(payload.abnormalSession).toEqual({ sessionId: 'abnormal' });
    expect(payload.deepTrace.status).toBe('recording');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a hung deep trace while retaining native and flight evidence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let health = {
      status: 'recording',
      pendingEventCount: 1,
      pendingBytes: 100,
      flushing: false,
      lastFailure: null,
    };
    mocks.getDeepTraceHealthSnapshot.mockImplementation(() => health);
    mocks.readDeepTraceSnapshot.mockImplementation(() => {
      health = {
        status: 'recording',
        pendingEventCount: 0,
        pendingBytes: 0,
        flushing: true,
        lastFailure: null,
      };
      return new Promise(() => {});
    });

    const exportPromise = buildDiagnosticsExport();
    await vi.advanceTimersByTimeAsync(5_001);
    const payload = JSON.parse(await (await exportPromise).blob.text());

    expect(payload.deepTrace).toMatchObject({ status: 'timeout', events: [] });
    expect(payload.deepTraceHealth).toEqual({
      status: 'recording',
      pendingEventCount: 0,
      pendingBytes: 0,
      flushing: true,
      lastFailure: null,
    });
    expect(payload.nativeDiagnostics).toMatchObject({
      status: 'available',
      events: [{ name: 'app.launch' }],
    });
    expect(payload.abnormalSession).toEqual({ sessionId: 'abnormal' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a hung native read while retaining deep trace and flight evidence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.readNativeDiagnostics.mockReturnValue(new Promise(() => {}));

    const exportPromise = buildDiagnosticsExport();
    await vi.advanceTimersByTimeAsync(5_001);
    const payload = JSON.parse(await (await exportPromise).blob.text());

    expect(payload.nativeDiagnostics).toMatchObject({ status: 'timeout', events: [] });
    expect(payload.deepTrace.status).toBe('recording');
    expect(payload.abnormalSession).toEqual({ sessionId: 'abnormal' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['rejects', 'hangs'])(
    'preserves the export-start memory tail when persistent tracing %s',
    async (mode) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      if (mode === 'rejects')
        mocks.readDeepTraceSnapshot.mockRejectedValue(new Error('storage failed'));
      else mocks.readDeepTraceSnapshot.mockReturnValue(new Promise(() => {}));
      const memory = {
        storage: 'memory',
        events: [{ name: 'thread.render', data: { reply_count: 1 } }],
      };
      mocks.readDeepTraceMemorySnapshot.mockReturnValue(memory);
      const exporting = buildDiagnosticsExport();
      mocks.readDeepTraceMemorySnapshot.mockReturnValue({ storage: 'memory', events: [] });
      await vi.advanceTimersByTimeAsync(5001);
      const payload = JSON.parse(await (await exporting).blob.text());
      expect(payload.deepTraceMemory).toEqual(memory);
      expect(payload.deepTrace.status).toBe(mode === 'rejects' ? 'unavailable' : 'timeout');
      expect(payload.nativeDiagnostics.status).toBe('available');
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('builds the same payload object without serialising it', async () => {
    const payload = await buildDiagnosticsPayload(1_784_513_628_415);
    expect(payload.metadata.exportSchemaVersion).toBe(DIAGNOSTICS_EXPORT_SCHEMA_VERSION);
    expect(JSON.parse(await (await buildDiagnosticsExport()).blob.text())).toEqual(payload);
  });
});
