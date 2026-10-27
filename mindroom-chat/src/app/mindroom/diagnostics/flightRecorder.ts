import { APP_BUILD_VERSION } from '../../../appVersion';
import {
  getSafeLocalStorage,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';

export const FLIGHT_RECORDER_CURRENT_KEY = 'mindroom.flight.current.v1';
export const FLIGHT_RECORDER_ABNORMAL_KEY = 'mindroom.flight.abnormal.v1';
export const FLIGHT_RECORDER_SCHEMA_VERSION = 1;
export const FLIGHT_RECORDER_MAX_EVENTS = 32;
export const FLIGHT_RECORDER_MAX_JSON_CHARS = 8192;
const HEARTBEAT_MS = 2000;
const GAP_MS = 5000;
const routes = ['home', 'direct', 'threads', 'space', 'auth', 'other'] as const;
const voices = ['inactive', 'requesting', 'recording', 'paused', 'processing'] as const;
const actionKinds = [
  'button',
  'checkbox',
  'control',
  'input',
  'link',
  'menuitem',
  'other',
  'radio',
  'range',
  'select',
  'surface',
  'switch',
  'tab',
  'textarea',
] as const;
const actionSurfaces = ['app', 'dialog', 'document', 'form', 'navigation', 'timeline'] as const;
const storedActionSurfaces = [...actionSurfaces, 'settings'] as const;
export const normalizeFlightRecorderBuildVersion = (value: string): string =>
  value
    .trim()
    .replace(/[^A-Za-z0-9._+-]/g, '_')
    .slice(0, 128) || 'unknown';
const FLIGHT_RECORDER_BUILD_VERSION = normalizeFlightRecorderBuildVersion(APP_BUILD_VERSION);
type RouteClass = typeof routes[number];
export type VoiceCaptureState = typeof voices[number];
export type FlightRecorderActionKind = typeof actionKinds[number];
export type FlightRecorderActionSurface = typeof actionSurfaces[number];
export type FlightRecorderLastAction = {
  at: number;
  kind: FlightRecorderActionKind;
  surface: FlightRecorderActionSurface | 'settings';
};
type EndReason = 'hidden' | 'pagehide';
type FlightEvent =
  | { at: number; type: 'voice'; state: VoiceCaptureState }
  | { at: number; type: 'lifecycle'; state: EndReason | 'visible' | 'pageshow' }
  | { at: number; type: 'route'; route: RouteClass; hasThreadId: boolean }
  | { at: number; type: 'heartbeat_gap'; delayMs: number };

export type FlightRecorderSession = {
  schemaVersion: typeof FLIGHT_RECORDER_SCHEMA_VERSION;
  buildVersion: string;
  sessionId: string;
  startedAt: number;
  lastBeatAt: number;
  visibility: 'visible' | 'hidden';
  route: RouteClass;
  hasThreadId: boolean;
  voiceCapture: VoiceCaptureState;
  expectedEndAt: number | null;
  endReason: EndReason | null;
  events: FlightEvent[];
  lastAction?: FlightRecorderLastAction;
};
type AbnormalSession = FlightRecorderSession & { detectedAt: number; startupGapMs: number };
type Runtime = {
  storage?: Storage;
  session?: FlightRecorderSession;
  preserved?: FlightRecorderSession;
  copiedPriorSessionId?: string;
  disabled: boolean;
  disposed: boolean;
  established: boolean;
  timer?: number;
  lastTick: number;
  removeListeners: () => void;
  dispose: () => void;
};
let activeRuntime: Runtime | undefined;

const read = (storage: Storage | undefined, key: string) => {
  try {
    if (!storage) return { ok: false as const, value: null };
    return { ok: true as const, value: storage.getItem(key) };
  } catch {
    return { ok: false as const, value: null };
  }
};
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const lastActionIsValid = (value: unknown): value is FlightRecorderLastAction => {
  const action = value as Partial<FlightRecorderLastAction> | null;
  return Boolean(
    action &&
      Object.keys(action).length === 3 &&
      number(action.at) &&
      actionKinds.includes(action.kind as FlightRecorderActionKind) &&
      storedActionSurfaces.includes(action.surface as typeof storedActionSurfaces[number])
  );
};
const eventIsValid = (value: unknown): value is FlightEvent => {
  const event = value as Partial<FlightEvent> | null;
  if (!event || !number(event.at)) return false;
  const keyCount = Object.keys(event).length;
  if (event.type === 'voice')
    return keyCount === 3 && voices.includes(event.state as VoiceCaptureState);
  if (event.type === 'lifecycle')
    return (
      keyCount === 3 &&
      ['hidden', 'pagehide', 'visible', 'pageshow'].includes(event.state as string)
    );
  if (event.type === 'route')
    return (
      keyCount === 4 &&
      routes.includes(event.route as RouteClass) &&
      typeof event.hasThreadId === 'boolean'
    );
  return (
    event.type === 'heartbeat_gap' &&
    keyCount === 3 &&
    number(event.delayMs) &&
    event.delayMs >= GAP_MS
  );
};
const sessionIsValid = (value: unknown): value is FlightRecorderSession => {
  const item = value as Partial<FlightRecorderSession> | null;
  const keyCount = item ? Object.keys(item).length : 0;
  return Boolean(
    item &&
      (keyCount === 12 || (keyCount === 13 && lastActionIsValid(item.lastAction))) &&
      item.schemaVersion === FLIGHT_RECORDER_SCHEMA_VERSION &&
      typeof item.buildVersion === 'string' &&
      /^[A-Za-z0-9._+-]{1,128}$/.test(item.buildVersion) &&
      typeof item.sessionId === 'string' &&
      /^[a-z0-9-]{1,64}$/.test(item.sessionId) &&
      number(item.startedAt) &&
      number(item.lastBeatAt) &&
      (item.visibility === 'visible' || item.visibility === 'hidden') &&
      routes.includes(item.route as RouteClass) &&
      typeof item.hasThreadId === 'boolean' &&
      voices.includes(item.voiceCapture as VoiceCaptureState) &&
      (item.expectedEndAt === null || number(item.expectedEndAt)) &&
      (item.endReason === null || item.endReason === 'hidden' || item.endReason === 'pagehide') &&
      (item.expectedEndAt === null) === (item.endReason === null) &&
      Array.isArray(item.events) &&
      item.events.length <= FLIGHT_RECORDER_MAX_EVENTS &&
      item.events.every(eventIsValid)
  );
};
const parse = (raw: string | null): FlightRecorderSession | undefined => {
  if (!raw || raw.length > FLIGHT_RECORDER_MAX_JSON_CHARS) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return sessionIsValid(value) ? value : undefined;
  } catch {
    return undefined;
  }
};
const parseAbnormal = (raw: string | null): AbnormalSession | undefined => {
  if (!raw || raw.length > FLIGHT_RECORDER_MAX_JSON_CHARS) return undefined;
  try {
    const abnormal = JSON.parse(raw) as AbnormalSession;
    const { detectedAt, startupGapMs, ...value } = abnormal;
    return (Object.keys(abnormal).length === 14 || Object.keys(abnormal).length === 15) &&
      number(detectedAt) &&
      number(startupGapMs) &&
      sessionIsValid(value) &&
      value.expectedEndAt === null
      ? { ...value, detectedAt, startupGapMs }
      : undefined;
  } catch {
    return undefined;
  }
};
const serialize = (value: FlightRecorderSession | AbnormalSession): string | undefined => {
  const serializable = { ...value, events: [...value.events] };
  let json = JSON.stringify(serializable);
  while (json.length > FLIGHT_RECORDER_MAX_JSON_CHARS && serializable.events.length) {
    serializable.events.shift();
    json = JSON.stringify(serializable);
  }
  return json.length <= FLIGHT_RECORDER_MAX_JSON_CHARS ? json : undefined;
};
const add = (runtime: Runtime, event: FlightEvent): void => {
  if (!runtime.session) return;
  runtime.session.events.push(event);
  if (runtime.session.events.length > FLIGHT_RECORDER_MAX_EVENTS) {
    runtime.session.events.shift();
  }
};
const stopTimer = (runtime: Runtime): void => {
  if (runtime.timer !== undefined) window.clearInterval(runtime.timer);
  runtime.timer = undefined;
};
const disable = (runtime: Runtime): void => {
  runtime.disabled = true;
  stopTimer(runtime);
};
const flush = (runtime: Runtime): boolean => {
  if (runtime.disabled || !runtime.storage || !runtime.session) return false;
  const json = serialize(runtime.session);
  if (!json || !setStorageItemSafe(runtime.storage, FLIGHT_RECORDER_CURRENT_KEY, json)) {
    if (runtime.established) {
      removeStorageItemSafe(runtime.storage, FLIGHT_RECORDER_CURRENT_KEY);
    }
    disable(runtime);
    return false;
  }
  return true;
};
const createRuntime = (storage: Storage | undefined): Runtime => {
  const runtime: Runtime = {
    storage,
    disabled: !storage,
    disposed: false,
    established: false,
    lastTick: 0,
    removeListeners: () => undefined,
    dispose: () => undefined,
  };
  runtime.dispose = () => {
    if (runtime.disposed) return;
    runtime.disposed = true;
    disable(runtime);
    runtime.removeListeners();
  };
  return runtime;
};

export const classifyFlightRecorderRoute = (
  href: string = window.location.href
): { route: RouteClass; hasThreadId: boolean } => {
  const url = new URL(href, window.location.origin);
  const segment = url.pathname.split('/').filter(Boolean)[0];
  let route: RouteClass = 'other';
  if (segment === 'home' || segment === 'direct' || segment === 'threads') route = segment;
  else if (segment && ['login', 'register', 'reset-password'].includes(segment)) route = 'auth';
  else if (
    segment &&
    // SPACE_PATH owns every non-reserved top-level segment as a Matrix space identifier.
    !['explore', 'create', 'inbox', 'space-settings', 'room-settings'].includes(segment)
  )
    route = 'space';
  return { route, hasThreadId: url.searchParams.has('threadId') };
};

export const classifyFlightRecorderAction = (
  target: EventTarget | null
): { kind: FlightRecorderActionKind; surface: FlightRecorderActionSurface } => {
  let surface: FlightRecorderActionSurface = 'document';
  if (target instanceof Element) {
    if (target.closest('[role="dialog"]')) surface = 'dialog';
    else if (target.closest('[data-message-id]')) surface = 'timeline';
    else if (target.closest('nav,[role="navigation"]')) surface = 'navigation';
    else if (target.closest('form')) surface = 'form';
    else surface = 'app';
  }

  if (!(target instanceof Element)) return { kind: 'other', surface };
  const control = target.closest('button,a,input,textarea,select,[role]');
  if (!control) return { kind: 'surface', surface };
  if (control instanceof HTMLAnchorElement) return { kind: 'link', surface };
  if (control instanceof HTMLButtonElement) return { kind: 'button', surface };
  if (control instanceof HTMLInputElement) {
    const kind = actionKinds.includes(control.type as FlightRecorderActionKind)
      ? (control.type as FlightRecorderActionKind)
      : 'input';
    return { kind, surface };
  }
  if (control instanceof HTMLTextAreaElement) return { kind: 'textarea', surface };
  if (control instanceof HTMLSelectElement) return { kind: 'select', surface };
  const role = control.getAttribute('role');
  const kind = ['button', 'menuitem', 'tab', 'switch'].includes(role ?? '')
    ? (role as FlightRecorderActionKind)
    : 'control';
  return { kind, surface };
};

export const installFlightRecorder = (
  storage: Storage | undefined = getSafeLocalStorage()
): (() => void) => {
  const previous = activeRuntime;
  if (previous && !previous.disabled && !previous.disposed && previous.storage === storage) {
    return previous.dispose;
  }
  const retainedSessionIds = new Set(
    [previous?.session?.sessionId, previous?.copiedPriorSessionId].filter(
      (sessionId): sessionId is string => sessionId !== undefined
    )
  );
  previous?.dispose();
  const runtime = createRuntime(storage);
  activeRuntime = runtime;
  const priorRead = read(storage, FLIGHT_RECORDER_CURRENT_KEY);
  try {
    if (!priorRead.ok) {
      disable(runtime);
      return runtime.dispose;
    }
    const abnormalRead = read(storage, FLIGHT_RECORDER_ABNORMAL_KEY);
    const retainedAbnormal = parseAbnormal(abnormalRead.value);
    if (
      !abnormalRead.ok ||
      (abnormalRead.value !== null &&
        !retainedAbnormal &&
        !removeStorageItemSafe(storage, FLIGHT_RECORDER_ABNORMAL_KEY))
    ) {
      disable(runtime);
      return runtime.dispose;
    }
    if (retainedAbnormal) retainedSessionIds.add(retainedAbnormal.sessionId);
    const now = Date.now();
    const prior = parse(priorRead.value);
    const initiallyVisible = document.visibilityState === 'visible';
    runtime.session = {
      schemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
      buildVersion: FLIGHT_RECORDER_BUILD_VERSION,
      sessionId:
        globalThis.crypto?.randomUUID?.() ??
        `${now.toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
      startedAt: now,
      lastBeatAt: now,
      visibility: initiallyVisible ? 'visible' : 'hidden',
      ...classifyFlightRecorderRoute(),
      voiceCapture: 'inactive',
      expectedEndAt: initiallyVisible ? null : now,
      endReason: initiallyVisible ? null : 'hidden',
      events: [],
    };
    let copiedPrior = false;
    if (prior?.expectedEndAt === null && !retainedSessionIds.has(prior.sessionId)) {
      const abnormal: AbnormalSession = {
        ...prior,
        events: [...prior.events],
        detectedAt: now,
        startupGapMs: Math.max(0, now - prior.lastBeatAt),
      };
      const json = serialize(abnormal);
      if (!json || !storage || !setStorageItemSafe(storage, FLIGHT_RECORDER_ABNORMAL_KEY, json)) {
        runtime.preserved = prior;
        disable(runtime);
        return runtime.dispose;
      }
      copiedPrior = true;
      runtime.copiedPriorSessionId = prior.sessionId;
    }
    const checkpoint = (detectGap: boolean) => {
      if (runtime.disabled || !runtime.session) return;
      if (document.visibilityState !== 'visible') {
        stopTimer(runtime);
        return;
      }
      const at = Date.now();
      const tick = performance.now();
      const delayMs = Math.max(0, tick - runtime.lastTick);
      runtime.lastTick = tick;
      const route = classifyFlightRecorderRoute();
      if (
        route.route !== runtime.session.route ||
        route.hasThreadId !== runtime.session.hasThreadId
      ) {
        Object.assign(runtime.session, route);
        add(runtime, { at, type: 'route', ...route });
      }
      runtime.session.lastBeatAt = at;
      runtime.session.visibility = document.visibilityState === 'visible' ? 'visible' : 'hidden';
      if (detectGap && delayMs >= GAP_MS) {
        add(runtime, { at, type: 'heartbeat_gap', delayMs });
      }
      flush(runtime);
    };
    const start = () => {
      stopTimer(runtime);
      if (runtime.disabled || document.visibilityState !== 'visible') return;
      runtime.lastTick = performance.now();
      runtime.timer = window.setInterval(() => checkpoint(true), HEARTBEAT_MS);
    };
    const end = (reason: EndReason) => {
      if (runtime.disabled || !runtime.session) return;
      const at = Date.now();
      Object.assign(runtime.session, {
        visibility: 'hidden',
        expectedEndAt: at,
        endReason: reason,
      });
      add(runtime, { at, type: 'lifecycle', state: reason });
      flush(runtime);
      stopTimer(runtime);
    };
    const resume = (state: 'visible' | 'pageshow') => {
      if (runtime.disabled || !runtime.session || document.visibilityState !== 'visible') {
        return;
      }
      if (runtime.session.endReason !== null) {
        Object.assign(runtime.session, { expectedEndAt: null, endReason: null });
        add(runtime, { at: Date.now(), type: 'lifecycle', state });
        checkpoint(false);
      } else if (runtime.timer !== undefined) {
        return;
      }
      start();
    };
    const visibility = () =>
      document.visibilityState === 'visible' ? resume('visible') : end('hidden');
    const pageHide = () => end('pagehide');
    const pageShow = () => resume('pageshow');
    runtime.removeListeners = () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    const visibleAfterRegistration = document.visibilityState === 'visible';
    if (visibleAfterRegistration !== initiallyVisible) {
      const at = Date.now();
      if (visibleAfterRegistration) {
        Object.assign(runtime.session, {
          visibility: 'visible',
          expectedEndAt: null,
          endReason: null,
        });
        add(runtime, { at, type: 'lifecycle', state: 'visible' });
      } else {
        Object.assign(runtime.session, {
          visibility: 'hidden',
          expectedEndAt: at,
          endReason: 'hidden',
        });
        add(runtime, { at, type: 'lifecycle', state: 'hidden' });
      }
    }
    if (!flush(runtime)) {
      if (!copiedPrior) runtime.preserved = prior;
      runtime.dispose();
      return runtime.dispose;
    }
    runtime.established = true;
    start();
    return runtime.dispose;
  } catch {
    if (runtime.established) {
      if (priorRead.value === null) removeStorageItemSafe(storage, FLIGHT_RECORDER_CURRENT_KEY);
      else setStorageItemSafe(storage, FLIGHT_RECORDER_CURRENT_KEY, priorRead.value);
    }
    runtime.dispose();
    return runtime.dispose;
  }
};

export const setFlightRecorderVoiceCaptureState = (state: VoiceCaptureState): void => {
  const runtime = activeRuntime;
  if (
    !runtime ||
    runtime.disabled ||
    !runtime.session ||
    !voices.includes(state) ||
    runtime.session.voiceCapture === state
  ) {
    return;
  }
  runtime.session.voiceCapture = state;
  add(runtime, { at: Date.now(), type: 'voice', state });
  flush(runtime);
};

export const setFlightRecorderLastAction = (
  action: { kind: FlightRecorderActionKind; surface: FlightRecorderActionSurface },
  at = Date.now()
): void => {
  const runtime = activeRuntime;
  if (
    !runtime ||
    runtime.disabled ||
    !runtime.session ||
    !number(at) ||
    !actionKinds.includes(action.kind) ||
    !actionSurfaces.includes(action.surface)
  ) {
    return;
  }
  runtime.session.lastAction = { at, ...action };
  flush(runtime);
};

export type FlightRecorderStatus = 'unexpected' | 'none' | 'unavailable';
export const getFlightRecorderStatus = (): FlightRecorderStatus => {
  const runtime = activeRuntime;
  if (!runtime?.storage) return 'unavailable';
  const abnormal = read(runtime.storage, FLIGHT_RECORDER_ABNORMAL_KEY);
  if (!abnormal.ok) return 'unavailable';
  if (parseAbnormal(abnormal.value)) return 'unexpected';
  return runtime.disabled ? 'unavailable' : 'none';
};

export const buildFlightRecorderPayload = () => {
  const runtime = activeRuntime;
  const abnormalRead = read(runtime?.storage, FLIGHT_RECORDER_ABNORMAL_KEY);
  const currentRead = runtime?.preserved
    ? undefined
    : read(runtime?.storage, FLIGHT_RECORDER_CURRENT_KEY);
  if (!abnormalRead.ok || currentRead?.ok === false)
    throw new Error('Diagnostics storage unavailable');
  const abnormalSession = parseAbnormal(abnormalRead.value);
  const currentSession = runtime?.preserved ?? parse(currentRead?.value ?? null) ?? null;
  const exportedAt = Date.now();
  return {
    metadata: {
      exportSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
      flightRecorderSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
      buildVersion: FLIGHT_RECORDER_BUILD_VERSION,
      exportedAt,
    },
    abnormalSession: abnormalSession ?? null,
    currentOrPreservedSession:
      currentSession?.sessionId === abnormalSession?.sessionId ? null : currentSession,
  };
};

export const buildFlightRecorderExport = (): { fileName: string; blob: Blob } => {
  const payload = buildFlightRecorderPayload();
  const { exportedAt } = payload.metadata;
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return {
    fileName: `mindroom-diagnostics-${timestamp}.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  };
};
