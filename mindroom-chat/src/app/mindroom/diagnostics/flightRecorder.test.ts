import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppOwnedCacheLocalStorage } from '../../utils/appOwnedStorage';
import { clearMindroomUserUiState } from '../cache/sessionCleanup';

const buildVersionMock = vi.hoisted(() => ({
  value: `release/candidate 1-${'x'.repeat(160)}`,
}));

vi.mock('../../../appVersion', () => ({
  APP_BUILD_VERSION: buildVersionMock.value,
}));

import {
  buildFlightRecorderExport,
  classifyFlightRecorderRoute,
  FLIGHT_RECORDER_ABNORMAL_KEY,
  FLIGHT_RECORDER_CURRENT_KEY,
  FLIGHT_RECORDER_MAX_EVENTS,
  FLIGHT_RECORDER_MAX_JSON_CHARS,
  type FlightRecorderSession,
  getFlightRecorderStatus,
  installFlightRecorder,
  normalizeFlightRecorderBuildVersion,
  setFlightRecorderLastAction,
  setFlightRecorderVoiceCaptureState,
} from './flightRecorder';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  readonly writes: string[] = [];

  failKey?: string;

  failReadKey?: string;

  failRemoveKey?: string;

  failWriteNumber?: number;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    if (key === this.failReadKey) throw new Error('storage read blocked');
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    if (key === this.failRemoveKey) throw new Error('storage removal blocked');
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.writes.push(key);
    if (key === this.failKey || this.writes.length === this.failWriteNumber) {
      throw new Error('storage blocked');
    }
    this.values.set(key, value);
  }
}

let priorSessionSequence = 0;
const makePriorSession = (
  overrides: Partial<FlightRecorderSession> = {}
): FlightRecorderSession => {
  priorSessionSequence += 1;
  return {
    schemaVersion: 1,
    buildVersion: 'prior-build',
    sessionId: `11111111-1111-4111-8111-${priorSessionSequence.toString().padStart(12, '0')}`,
    startedAt: 900,
    lastBeatAt: 950,
    visibility: 'visible',
    route: 'home',
    hasThreadId: false,
    voiceCapture: 'recording',
    expectedEndAt: null,
    endReason: null,
    events: [],
    ...overrides,
  };
};

const readCurrent = (storage: MemoryStorage): FlightRecorderSession =>
  JSON.parse(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY) ?? 'null') as FlightRecorderSession;

describe('iOS freeze flight recorder', () => {
  let storage: MemoryStorage;
  let visible: DocumentVisibilityState;
  let href: string;
  let documentTarget: EventTarget;
  let windowTarget: EventTarget;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    storage = new MemoryStorage();
    visible = 'visible';
    href = 'https://chat.mindroom.test/home/';
    documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'visibilityState', {
      configurable: true,
      get: () => visible,
    });
    windowTarget = new EventTarget();
    Object.defineProperties(windowTarget, {
      location: {
        configurable: true,
        get: () => ({ href, origin: 'https://chat.mindroom.test' }),
      },
      setInterval: { configurable: true, value: globalThis.setInterval },
      clearInterval: { configurable: true, value: globalThis.clearInterval },
    });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('updates visible scalar checkpoints every two seconds without growing the ring', () => {
    dispose = installFlightRecorder(storage);

    vi.advanceTimersByTime(6000);

    const current = readCurrent(storage);
    expect(current.lastBeatAt).toBe(7000);
    expect(current.visibility).toBe('visible');
    expect(current.events).toEqual([]);
    expect(storage.writes).toEqual([
      FLIGHT_RECORDER_CURRENT_KEY,
      FLIGHT_RECORDER_CURRENT_KEY,
      FLIGHT_RECORDER_CURRENT_KEY,
      FLIGHT_RECORDER_CURRENT_KEY,
    ]);
  });

  it('uses one normalized bounded build version for storage and export metadata', async () => {
    dispose = installFlightRecorder(storage);
    const expected = normalizeFlightRecorderBuildVersion(buildVersionMock.value);
    const payload = JSON.parse(await buildFlightRecorderExport().blob.text());

    expect(expected).toHaveLength(128);
    expect(expected).toMatch(/^[A-Za-z0-9._+-]+$/);
    expect(expected).not.toMatch(/[ /]/);
    expect(readCurrent(storage).buildVersion).toBe(expected);
    expect(payload.metadata.buildVersion).toBe(expected);
  });

  it.each([
    [4999, false],
    [5000, true],
  ])('applies the recovered-gap boundary at %i ms', (delay, shouldRecord) => {
    let monotonicNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    dispose = installFlightRecorder(storage);

    monotonicNow = delay;
    vi.advanceTimersByTime(2000);

    expect(readCurrent(storage).events).toEqual(
      shouldRecord ? [{ at: 3000, type: 'heartbeat_gap', delayMs: delay }] : []
    );
  });

  it('stops a racing heartbeat before any hidden-state mutation or flush', () => {
    let monotonicNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    dispose = installFlightRecorder(storage);
    const beforeHidden = storage.getItem(FLIGHT_RECORDER_CURRENT_KEY);
    const writesBeforeHidden = storage.writes.length;

    visible = 'hidden';
    monotonicNow = 6000;
    vi.advanceTimersByTime(6000);

    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBe(beforeHidden);
    expect(storage.writes).toHaveLength(writesBeforeHidden);
  });

  it('restarts a dead heartbeat on visible pageshow without a resume-shaped write', () => {
    dispose = installFlightRecorder(storage);
    visible = 'hidden';
    vi.advanceTimersByTime(2000);
    const writesBeforePageShow = storage.writes.length;

    visible = 'visible';
    windowTarget.dispatchEvent(new Event('pageshow'));
    expect(storage.writes).toHaveLength(writesBeforePageShow);

    vi.advanceTimersByTime(2000);
    expect(readCurrent(storage)).toMatchObject({
      lastBeatAt: 5000,
      expectedEndAt: null,
      endReason: null,
      events: [],
    });
    expect(storage.writes).toHaveLength(writesBeforePageShow + 1);
  });

  it('orders lifecycle transitions, ignores initial pageshow, and preserves hidden markers', () => {
    dispose = installFlightRecorder(storage);
    const initialWrites = storage.writes.length;
    windowTarget.dispatchEvent(new Event('pageshow'));
    expect(storage.writes).toHaveLength(initialWrites);
    expect(readCurrent(storage).events).toEqual([]);

    vi.advanceTimersByTime(2000);
    visible = 'hidden';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    const hidden = readCurrent(storage);

    expect(hidden).toMatchObject({
      visibility: 'hidden',
      expectedEndAt: 3000,
      endReason: 'hidden',
    });
    vi.advanceTimersByTime(4000);
    expect(readCurrent(storage).lastBeatAt).toBe(hidden.lastBeatAt);

    windowTarget.dispatchEvent(new Event('pageshow'));
    expect(readCurrent(storage)).toMatchObject({
      visibility: 'hidden',
      expectedEndAt: 3000,
      endReason: 'hidden',
    });

    visible = 'visible';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(readCurrent(storage)).toMatchObject({
      visibility: 'visible',
      lastBeatAt: 7000,
      expectedEndAt: null,
      endReason: null,
    });

    windowTarget.dispatchEvent(new Event('pagehide'));
    expect(readCurrent(storage).endReason).toBe('pagehide');
    windowTarget.dispatchEvent(new Event('pageshow'));
    expect(readCurrent(storage)).toMatchObject({ expectedEndAt: null, endReason: null });
    expect(
      readCurrent(storage)
        .events.filter((event) => event.type === 'lifecycle')
        .map((event) => event.state)
    ).toEqual(['hidden', 'visible', 'pagehide', 'pageshow']);
  });

  it('records the first foreground transition after installation while hidden', () => {
    visible = 'hidden';
    dispose = installFlightRecorder(storage);

    expect(readCurrent(storage)).toMatchObject({
      visibility: 'hidden',
      expectedEndAt: 1000,
      endReason: 'hidden',
      events: [],
    });

    visible = 'visible';
    documentTarget.dispatchEvent(new Event('visibilitychange'));

    expect(readCurrent(storage)).toMatchObject({
      visibility: 'visible',
      lastBeatAt: 1000,
      expectedEndAt: null,
      endReason: null,
      events: [{ at: 1000, type: 'lifecycle', state: 'visible' }],
    });
    vi.advanceTimersByTime(2000);
    expect(readCurrent(storage).lastBeatAt).toBe(3000);
  });

  it('does not retain a session killed before a hidden launch reaches foreground', () => {
    visible = 'hidden';
    dispose = installFlightRecorder(storage);
    const killedHiddenSession = readCurrent(storage);
    expect(killedHiddenSession).toMatchObject({
      startedAt: 1000,
      lastBeatAt: 1000,
      visibility: 'hidden',
      expectedEndAt: 1000,
      endReason: 'hidden',
      events: [],
    });

    const relaunchStorage = new MemoryStorage();
    relaunchStorage.values.set(
      FLIGHT_RECORDER_CURRENT_KEY,
      JSON.stringify({
        ...killedHiddenSession,
        sessionId: '22222222-2222-4222-8222-222222222222',
      })
    );
    visible = 'visible';
    dispose = installFlightRecorder(relaunchStorage);

    expect(relaunchStorage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
    expect(readCurrent(relaunchStorage).sessionId).not.toBe('22222222-2222-4222-8222-222222222222');
  });

  it('records route changes only on the next heartbeat', () => {
    dispose = installFlightRecorder(storage);
    href = 'https://chat.mindroom.test/direct/%40private?threadId=%24secret';

    expect(readCurrent(storage).route).toBe('home');
    vi.advanceTimersByTime(1999);
    expect(readCurrent(storage).events).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(readCurrent(storage)).toMatchObject({
      route: 'direct',
      hasThreadId: true,
    });
    expect(readCurrent(storage).events).toEqual([
      {
        at: 3000,
        type: 'route',
        route: 'direct',
        hasThreadId: true,
      },
    ]);
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).not.toContain('private');
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).not.toContain('secret');
  });

  it('writes one categorical last action synchronously in the triggering task', () => {
    dispose = installFlightRecorder(storage);

    const triggerThenHang = () => {
      setFlightRecorderLastAction({ kind: 'button', surface: 'timeline' }, 1001);
      throw new Error('simulated same-task hang');
    };

    expect(triggerThenHang).toThrow('simulated same-task hang');
    expect(readCurrent(storage).lastAction).toEqual({
      at: 1001,
      kind: 'button',
      surface: 'timeline',
    });
  });

  it('rejects non-categorical last actions without changing durable evidence', () => {
    dispose = installFlightRecorder(storage);
    const before = storage.getItem(FLIGHT_RECORDER_CURRENT_KEY);

    setFlightRecorderLastAction({ kind: 'private-label' as 'button', surface: 'timeline' });

    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBe(before);
  });

  it('makes repeated active installation idempotent without replacing trace evidence', () => {
    const firstDispose = installFlightRecorder(storage);
    const firstSessionId = readCurrent(storage).sessionId;
    setFlightRecorderVoiceCaptureState('recording');
    const writesBeforeReinstall = storage.writes.length;
    const secondDispose = installFlightRecorder(storage);
    dispose = secondDispose;

    expect(secondDispose).toBe(firstDispose);
    expect(readCurrent(storage)).toMatchObject({
      sessionId: firstSessionId,
      voiceCapture: 'recording',
    });
    expect(storage.writes).toHaveLength(writesBeforeReinstall);
    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
  });

  it('scopes stale disposal and post-dispose writes to one install generation', () => {
    const firstDispose = installFlightRecorder(storage);
    const replacementStorage = new MemoryStorage();
    const secondDispose = installFlightRecorder(replacementStorage);
    dispose = secondDispose;

    firstDispose();
    vi.advanceTimersByTime(2000);
    expect(readCurrent(replacementStorage).lastBeatAt).toBe(3000);

    secondDispose();
    const writesAfterDispose = replacementStorage.writes.length;
    setFlightRecorderVoiceCaptureState('recording');
    vi.advanceTimersByTime(4000);
    expect(replacementStorage.writes).toHaveLength(writesAfterDispose);
  });

  it('returns an inert generation disposer when installation fails', () => {
    storage.failReadKey = FLIGHT_RECORDER_CURRENT_KEY;
    const failedDispose = installFlightRecorder(storage);
    storage.failReadKey = undefined;
    dispose = installFlightRecorder(storage);

    failedDispose();
    vi.advanceTimersByTime(2000);

    expect(readCurrent(storage).lastBeatAt).toBe(3000);
  });

  it('rolls back a partial setup failure and leaves its disposer inert', () => {
    vi.spyOn(windowTarget, 'addEventListener').mockImplementationOnce(() => {
      throw new Error('listener setup failed');
    });

    expect(() => {
      dispose = installFlightRecorder(storage);
    }).not.toThrow();
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBeNull();
    expect(getFlightRecorderStatus()).toBe('unavailable');

    const writesAfterFailure = storage.writes.length;
    visible = 'hidden';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    setFlightRecorderVoiceCaptureState('recording');
    vi.advanceTimersByTime(4000);
    dispose();

    expect(storage.writes).toHaveLength(writesAfterFailure);
  });

  it('does not expose a marker-free session before lifecycle listeners are installed', () => {
    storage.failRemoveKey = FLIGHT_RECORDER_CURRENT_KEY;
    vi.spyOn(windowTarget, 'addEventListener').mockImplementationOnce(() => {
      throw new Error('listener setup failed');
    });

    dispose = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBeNull();
    expect(getFlightRecorderStatus()).toBe('unavailable');
  });

  it('persists an expected end when visibility changes before listener registration', () => {
    const addDocumentListener = documentTarget.addEventListener.bind(documentTarget);
    vi.spyOn(documentTarget, 'addEventListener').mockImplementationOnce(
      (type, listener, options) => {
        visible = 'hidden';
        addDocumentListener(type, listener, options);
      }
    );

    dispose = installFlightRecorder(storage);

    expect(readCurrent(storage)).toMatchObject({
      visibility: 'hidden',
      expectedEndAt: 1000,
      endReason: 'hidden',
      events: [{ at: 1000, type: 'lifecycle', state: 'hidden' }],
    });
  });

  it('restores pre-existing current bytes after a partial setup failure', () => {
    const prior = makePriorSession({ expectedEndAt: 990, endReason: 'hidden' });
    const priorBytes = JSON.stringify(prior);
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, priorBytes);
    vi.spyOn(windowTarget, 'addEventListener').mockImplementationOnce(() => {
      throw new Error('listener setup failed');
    });

    dispose = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBe(priorBytes);
    expect(getFlightRecorderStatus()).toBe('unavailable');
  });

  it('retains every valid marker-free prior session even after a fast relaunch', () => {
    const prior = makePriorSession({
      lastAction: { at: 940, kind: 'range', surface: 'settings' },
    });
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, JSON.stringify(prior));

    dispose = installFlightRecorder(storage);

    const abnormal = JSON.parse(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY) ?? 'null');
    expect(abnormal).toMatchObject({
      sessionId: prior.sessionId,
      detectedAt: 1000,
      startupGapMs: 50,
      lastAction: { at: 940, kind: 'range', surface: 'settings' },
    });
    expect(abnormal.events).not.toContainEqual(expect.objectContaining({ type: 'heartbeat_gap' }));
    expect(readCurrent(storage).sessionId).not.toBe(prior.sessionId);
    expect(storage.writes.slice(0, 2)).toEqual([
      FLIGHT_RECORDER_ABNORMAL_KEY,
      FLIGHT_RECORDER_CURRENT_KEY,
    ]);
  });

  it('preserves first-detection metadata when both durable slots contain one session', () => {
    const prior = makePriorSession();
    const priorBytes = JSON.stringify(prior);
    const abnormalBytes = JSON.stringify({
      ...prior,
      detectedAt: 975,
      startupGapMs: 25,
    });
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, priorBytes);
    storage.values.set(FLIGHT_RECORDER_ABNORMAL_KEY, abnormalBytes);
    storage.failKey = FLIGHT_RECORDER_CURRENT_KEY;

    dispose = installFlightRecorder(storage);
    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBe(abnormalBytes);
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBe(priorBytes);

    storage.failKey = undefined;
    dispose = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBe(abnormalBytes);
    expect(readCurrent(storage).sessionId).not.toBe(prior.sessionId);
  });

  it('replaces an unrelated abnormal snapshot with the marker-free current session', () => {
    const unrelated = makePriorSession();
    const prior = makePriorSession();
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, JSON.stringify(prior));
    storage.values.set(
      FLIGHT_RECORDER_ABNORMAL_KEY,
      JSON.stringify({ ...unrelated, detectedAt: 900, startupGapMs: 25 })
    );

    dispose = installFlightRecorder(storage);

    expect(JSON.parse(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY) ?? 'null')).toMatchObject({
      sessionId: prior.sessionId,
      detectedAt: 1000,
      startupGapMs: 50,
    });
    expect(readCurrent(storage).sessionId).not.toBe(prior.sessionId);
  });

  it('starts after an expected end without replacing the retained abnormal session', () => {
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, JSON.stringify(makePriorSession()));
    dispose = installFlightRecorder(storage);
    dispose();
    const retainedAbnormal = storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY);
    storage.values.set(
      FLIGHT_RECORDER_CURRENT_KEY,
      JSON.stringify(
        makePriorSession({
          expectedEndAt: 990,
          endReason: 'hidden',
        })
      )
    );

    dispose = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBe(retainedAbnormal);
    expect(readCurrent(storage).expectedEndAt).toBeNull();
  });

  it('preserves old current bytes and disables later writes when abnormal copy fails', async () => {
    const prior = makePriorSession();
    const priorBytes = JSON.stringify(prior);
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, priorBytes);
    storage.failKey = FLIGHT_RECORDER_ABNORMAL_KEY;

    dispose = installFlightRecorder(storage);
    setFlightRecorderVoiceCaptureState('paused');

    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBe(priorBytes);
    expect(storage.writes).toEqual([FLIGHT_RECORDER_ABNORMAL_KEY]);
    expect(getFlightRecorderStatus()).toBe('unavailable');
    const exported = JSON.parse(await buildFlightRecorderExport().blob.text());
    expect(exported.currentOrPreservedSession).toEqual(prior);
  });

  it('prioritizes retained abnormal evidence when the replacement write fails', async () => {
    const prior = makePriorSession();
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, JSON.stringify(prior));
    storage.failWriteNumber = 2;

    dispose = installFlightRecorder(storage);

    expect(getFlightRecorderStatus()).toBe('unexpected');
    const exported = JSON.parse(await buildFlightRecorderExport().blob.text());
    expect(exported.abnormalSession).toMatchObject({ sessionId: prior.sessionId });
    expect(exported.currentOrPreservedSession).toBeNull();
  });

  it('removes established live-looking bytes after a mid-session write failure', () => {
    dispose = installFlightRecorder(storage);
    storage.failKey = FLIGHT_RECORDER_CURRENT_KEY;

    setFlightRecorderVoiceCaptureState('recording');

    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBeNull();
    expect(getFlightRecorderStatus()).toBe('unavailable');

    storage.failKey = undefined;
    dispose = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
    expect(readCurrent(storage).voiceCapture).toBe('inactive');
  });

  it('never replaces prior bytes when the startup read fails', async () => {
    const prior = makePriorSession();
    const priorBytes = JSON.stringify(prior);
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, priorBytes);
    storage.failReadKey = FLIGHT_RECORDER_CURRENT_KEY;

    dispose = installFlightRecorder(storage);

    expect(storage.values.get(FLIGHT_RECORDER_CURRENT_KEY)).toBe(priorBytes);
    expect(storage.writes).toEqual([]);
    expect(getFlightRecorderStatus()).toBe('unavailable');

    storage.failReadKey = undefined;
    const exported = JSON.parse(await buildFlightRecorderExport().blob.text());
    expect(exported.currentOrPreservedSession).toEqual(prior);
  });

  it('fails closed on malformed or unavailable storage without interrupting boot', () => {
    storage.values.set(
      FLIGHT_RECORDER_CURRENT_KEY,
      JSON.stringify({ ...makePriorSession(), extra: 'private text' })
    );
    expect(() => {
      dispose = installFlightRecorder(storage);
    }).not.toThrow();
    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).not.toContain('private text');

    dispose();
    vi.stubGlobal('localStorage', undefined);
    expect(() => {
      dispose = installFlightRecorder();
    }).not.toThrow();
    expect(getFlightRecorderStatus()).toBe('unavailable');
  });

  it.each([
    ['malformed', '{'],
    ['oversized', 'x'.repeat(FLIGHT_RECORDER_MAX_JSON_CHARS + 1)],
    ['free-form', JSON.stringify({ privateText: 'must not persist' })],
    [
      'normally ended',
      JSON.stringify({
        ...makePriorSession({ expectedEndAt: 990, endReason: 'hidden' }),
        detectedAt: 1000,
        startupGapMs: 50,
      }),
    ],
  ])('removes %s abnormal-slot data during startup', (_case, abnormalBytes) => {
    storage.values.set(FLIGHT_RECORDER_ABNORMAL_KEY, abnormalBytes);

    dispose = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
    expect(getFlightRecorderStatus()).toBe('none');
  });

  it('fails closed when invalid abnormal-slot cleanup fails', () => {
    storage.values.set(FLIGHT_RECORDER_ABNORMAL_KEY, '{');
    storage.failRemoveKey = FLIGHT_RECORDER_ABNORMAL_KEY;

    dispose = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBe('{');
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBeNull();
    expect(getFlightRecorderStatus()).toBe('unavailable');
  });

  it('caps the significant-event ring and serialized envelope while preserving metadata', () => {
    dispose = installFlightRecorder(storage);
    for (let index = 0; index < 40; index += 1) {
      setFlightRecorderVoiceCaptureState(index % 2 === 0 ? 'recording' : 'paused');
    }
    setFlightRecorderVoiceCaptureState('private text' as 'recording');

    const raw = storage.getItem(FLIGHT_RECORDER_CURRENT_KEY) ?? '';
    const current = readCurrent(storage);
    expect(raw.length).toBeLessThanOrEqual(FLIGHT_RECORDER_MAX_JSON_CHARS);
    expect(current.events).toHaveLength(FLIGHT_RECORDER_MAX_EVENTS);
    expect(current.events[0]).toMatchObject({ type: 'voice', state: 'recording' });
    expect(current.events.at(-1)).toMatchObject({ type: 'voice', state: 'paused' });
    expect(current).toMatchObject({
      schemaVersion: 1,
      sessionId: expect.any(String),
      startedAt: 1000,
    });
    expect(raw).not.toContain('private text');

    const at = Number.MAX_VALUE;
    const longestEvent = [
      { at, type: 'voice', state: 'processing' },
      { at, type: 'lifecycle', state: 'pagehide' },
      { at, type: 'route', route: 'threads', hasThreadId: false },
      { at, type: 'heartbeat_gap', delayMs: Number.MAX_VALUE },
    ].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    const maximumFixedShape = {
      ...makePriorSession({
        buildVersion: 'a'.repeat(128),
        sessionId: 'a'.repeat(64),
        startedAt: at,
        lastBeatAt: at,
        visibility: 'hidden',
        route: 'threads',
        hasThreadId: false,
        voiceCapture: 'processing',
        expectedEndAt: at,
        endReason: 'pagehide',
      }),
      events: Array.from({ length: FLIGHT_RECORDER_MAX_EVENTS }, () => longestEvent),
    };
    expect(JSON.stringify(maximumFixedShape).length).toBeLessThanOrEqual(
      FLIGHT_RECORDER_MAX_JSON_CHARS
    );
  });

  it('classifies only fixed route values and boolean thread presence', () => {
    const cases = [
      ['https://chat.test/home/%21secret?threadId=%24secret#fragment', 'home', true],
      ['https://chat.test/direct/%40alice:secret', 'direct', false],
      ['https://chat.test/threads/?filter=secret', 'threads', false],
      ['https://chat.test/login/https%3A%2F%2Fsecret', 'auth', false],
      ['https://chat.test/register/secret', 'auth', false],
      ['https://chat.test/reset-password/secret', 'auth', false],
      ['https://chat.test/%23private:secret/lobby', 'space', false],
      ['https://chat.test/explore/secret', 'other', false],
    ] as const;

    cases.forEach(([url, route, hasThreadId]) => {
      const result = classifyFlightRecorderRoute(url);
      expect(result).toEqual({ route, hasThreadId });
      expect(JSON.stringify(result)).not.toContain('secret');
    });
  });

  it('exports abnormal and current sessions without deleting retained data', async () => {
    const prior = makePriorSession();
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, JSON.stringify(prior));
    dispose = installFlightRecorder(storage);
    const before = new Map(storage.values);

    const { fileName, blob } = buildFlightRecorderExport();
    const payload = JSON.parse(await blob.text());

    expect(fileName).toMatch(/^mindroom-diagnostics-.*Z\.json$/);
    expect(payload.metadata).toMatchObject({
      exportSchemaVersion: 1,
      flightRecorderSchemaVersion: 1,
      buildVersion: expect.any(String),
      exportedAt: 1000,
    });
    expect(payload.abnormalSession.sessionId).toBe(prior.sessionId);
    expect(payload.currentOrPreservedSession.sessionId).not.toBe(payload.abnormalSession.sessionId);
    expect(storage.values).toEqual(before);

    storage.failReadKey = FLIGHT_RECORDER_ABNORMAL_KEY;
    expect(getFlightRecorderStatus()).toBe('unavailable');
    expect(() => buildFlightRecorderExport()).toThrow('Diagnostics storage unavailable');
  });

  it('keeps both diagnostic keys outside Clear Cache and logout ownership', () => {
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, 'current');
    storage.values.set(FLIGHT_RECORDER_ABNORMAL_KEY, 'abnormal');

    clearAppOwnedCacheLocalStorage(storage);
    clearMindroomUserUiState('@alice:example.org');

    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBe('current');
    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBe('abnormal');
  });
});
