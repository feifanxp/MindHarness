import { Capacitor, registerPlugin } from '@capacitor/core';

export const NATIVE_DIAGNOSTICS_SCHEMA_VERSION = 1;

const NATIVE_DIAGNOSTICS_MAX_EVENTS = 128;
const NATIVE_DIAGNOSTICS_MAX_BYTES = 64 * 1024;

const EVENT_NAMES = new Set([
  'app.launch',
  'memory.warning',
  'navigation.failed',
  'navigation.finished',
  'navigation.provisional_failed',
  'navigation.started',
  'scene.active',
  'scene.background',
  'scene.disconnected',
  'scene.foreground',
  'scene.inactive',
  'webview.terminated',
]);

const ERROR_DOMAINS = new Set(['url', 'webkit', 'cocoa', 'other']);
const BOOLEAN_DATA_KEYS = new Set([
  'attached',
  'emptyBounds',
  'hidden',
  'loading',
  'opaque',
  'transparent',
]);
const NUMBER_DATA_KEYS = new Set(['applicationState', 'errorCode', 'progress', 'sceneState']);

type NativeDiagnosticData = {
  applicationState?: number;
  sceneState?: number;
  loading?: boolean;
  progress?: number;
  attached?: boolean;
  hidden?: boolean;
  opaque?: boolean;
  transparent?: boolean;
  emptyBounds?: boolean;
  errorDomain?: 'url' | 'webkit' | 'cocoa' | 'other';
  errorCode?: number;
};

export type NativeDiagnosticEvent = {
  at: number;
  monotonicMs: number;
  sequence: number;
  sessionId: string;
  name: string;
  data?: NativeDiagnosticData;
};

type NativePluginSnapshot = {
  schemaVersion: 1;
  status: 'available' | 'unavailable' | 'corrupt';
  currentSessionId: string;
  events: NativeDiagnosticEvent[];
  droppedEventCount: number;
};

export type NativeDiagnosticsSnapshot = Omit<
  NativePluginSnapshot,
  'status' | 'currentSessionId'
> & {
  status: NativePluginSnapshot['status'] | 'unsupported' | 'timeout' | 'invalid';
  currentSessionId: string | null;
};

type MindRoomDiagnosticsPlugin = {
  read(): Promise<unknown>;
};

let mindRoomDiagnosticsPlugin: MindRoomDiagnosticsPlugin | undefined;

export const createEmptyNativeDiagnosticsSnapshot = (
  status: Extract<
    NativeDiagnosticsSnapshot['status'],
    'unsupported' | 'timeout' | 'invalid' | 'unavailable'
  >
): NativeDiagnosticsSnapshot => ({
  schemaVersion: NATIVE_DIAGNOSTICS_SCHEMA_VERSION,
  status,
  currentSessionId: null,
  events: [],
  droppedEventCount: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  isFiniteNonNegative(value) && Number.isSafeInteger(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const normalizeData = (value: unknown): NativeDiagnosticData | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('invalid native diagnostic data');

  const safeData: Record<string, number | boolean | string> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (BOOLEAN_DATA_KEYS.has(key)) {
      if (typeof item !== 'boolean') throw new Error('invalid native diagnostic boolean');
      safeData[key] = item;
    } else if (NUMBER_DATA_KEYS.has(key)) {
      if (typeof item !== 'number' || !Number.isFinite(item)) {
        throw new Error('invalid native diagnostic number');
      }
      safeData[key] = item;
    } else if (key === 'errorDomain') {
      if (typeof item !== 'string' || !ERROR_DOMAINS.has(item)) {
        throw new Error('invalid native diagnostic error domain');
      }
      safeData[key] = item;
    }
  });
  return Object.keys(safeData).length > 0 ? (safeData as NativeDiagnosticData) : undefined;
};

const normalizeEvent = (value: unknown): NativeDiagnosticEvent => {
  if (!isRecord(value)) throw new Error('invalid native diagnostic event');
  const { at, monotonicMs, sequence, sessionId, name } = value;
  if (
    !isFiniteNonNegative(at) ||
    !isFiniteNonNegative(monotonicMs) ||
    !isNonNegativeInteger(sequence) ||
    !isUuid(sessionId) ||
    typeof name !== 'string' ||
    !EVENT_NAMES.has(name)
  ) {
    throw new Error('invalid native diagnostic event');
  }
  const data = normalizeData(value.data);
  return {
    at,
    monotonicMs,
    sequence,
    sessionId,
    name,
    ...(data ? { data } : {}),
  };
};

const byteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const normalizeSnapshot = (value: unknown): NativeDiagnosticsSnapshot => {
  if (!isRecord(value)) throw new Error('invalid native diagnostic snapshot');
  const { schemaVersion, status, currentSessionId, events, droppedEventCount } = value;
  if (
    schemaVersion !== NATIVE_DIAGNOSTICS_SCHEMA_VERSION ||
    (status !== 'available' && status !== 'unavailable' && status !== 'corrupt') ||
    !isUuid(currentSessionId) ||
    !Array.isArray(events) ||
    !isNonNegativeInteger(droppedEventCount)
  ) {
    throw new Error('invalid native diagnostic snapshot');
  }

  const countOverflow = Math.max(0, events.length - NATIVE_DIAGNOSTICS_MAX_EVENTS);
  const normalizedEvents = events.slice(countOverflow).map(normalizeEvent);
  let firstRetainedIndex = 0;
  while (
    firstRetainedIndex < normalizedEvents.length &&
    byteLength(normalizedEvents.slice(firstRetainedIndex)) > NATIVE_DIAGNOSTICS_MAX_BYTES
  ) {
    firstRetainedIndex += 1;
  }
  return {
    schemaVersion: NATIVE_DIAGNOSTICS_SCHEMA_VERSION,
    status,
    currentSessionId,
    events: normalizedEvents.slice(firstRetainedIndex),
    droppedEventCount: Math.min(
      Number.MAX_SAFE_INTEGER,
      droppedEventCount + countOverflow + firstRetainedIndex
    ),
  };
};

const isNativeIOSDiagnosticsAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomDiagnostics');

const getMindRoomDiagnosticsPlugin = (): MindRoomDiagnosticsPlugin => {
  if (!mindRoomDiagnosticsPlugin) {
    mindRoomDiagnosticsPlugin = registerPlugin<MindRoomDiagnosticsPlugin>('MindRoomDiagnostics');
  }
  return mindRoomDiagnosticsPlugin;
};

export const readNativeDiagnostics = async (): Promise<NativeDiagnosticsSnapshot> => {
  if (!isNativeIOSDiagnosticsAvailable()) {
    return createEmptyNativeDiagnosticsSnapshot('unsupported');
  }
  let value: unknown;
  try {
    value = await getMindRoomDiagnosticsPlugin().read();
  } catch {
    return createEmptyNativeDiagnosticsSnapshot('unavailable');
  }
  try {
    return normalizeSnapshot(value);
  } catch {
    return createEmptyNativeDiagnosticsSnapshot('invalid');
  }
};
