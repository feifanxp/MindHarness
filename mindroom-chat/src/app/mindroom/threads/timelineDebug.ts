/* eslint-disable no-console */
import {
  getDeepTraceRuntimeStatus,
  recordDeepTraceEvent,
  type DeepTraceData,
} from '../diagnostics/deepTrace';
import { THREAD_TRACE_PHASES } from '../diagnostics/threadTraceSchema';

const TIMELINE_DEBUG_STORAGE_KEY = 'mindroom.debug.timeline';

let traceCounter = 0;

const getTimelineDebugStorage = (): Storage | undefined => {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
};

const sanitizeTracePart = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-48) || 'unknown';

export const isTimelineDebugEnabled = (): boolean => {
  try {
    return getTimelineDebugStorage()?.getItem(TIMELINE_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const createTimelineDebugTrace = (
  scope: 'room-open' | 'thread-open',
  roomId: string,
  threadId?: string
): string => {
  traceCounter += 1;
  const traceParts = [scope, String(traceCounter), sanitizeTracePart(roomId)];
  if (threadId) {
    traceParts.push(sanitizeTracePart(threadId));
  }
  return traceParts.join('#');
};

export const logTimelineDebug = (
  traceId: string | undefined,
  phase: string,
  payload?: Record<string, unknown>
): void => {
  const phaseSchema = Object.prototype.hasOwnProperty.call(THREAD_TRACE_PHASES, phase)
    ? THREAD_TRACE_PHASES[phase]
    : undefined;
  const status = getDeepTraceRuntimeStatus();
  if (
    phaseSchema &&
    (status === 'recording' || status === 'memory-only' || status === 'starting')
  ) {
    // Existing console trace IDs contain private identifiers. Export only the
    // page-local counter, never the ID itself or arbitrary debug payload keys.
    const counter = /^thread-open#([1-9][0-9]*)#/.exec(traceId ?? '')?.[1];
    const traceNumber = Number(counter);
    if (counter && Number.isSafeInteger(traceNumber)) {
      const data: DeepTraceData = { trace_id: traceNumber };
      phaseSchema[1].forEach((key) => {
        const value = payload?.[key];
        if (
          value === null ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        ) {
          data[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value;
        }
      });
      recordDeepTraceEvent(phaseSchema[0], data);
    }
  }
  if (!traceId || !isTimelineDebugEnabled()) return;

  if (payload) {
    console.log(`[timeline-debug] ${traceId} ${phase}`, payload);
    return;
  }

  console.log(`[timeline-debug] ${traceId} ${phase}`);
};
