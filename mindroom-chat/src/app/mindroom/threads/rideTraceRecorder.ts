/* eslint-disable no-console */
import { getCacheProbeCounter, getCacheProbeSnapshot } from './cacheProbe';
import { hasActiveWindowTouches, isIOSWebKitDevice } from './scrollQuiescence';
import { copyToClipboard } from '../../utils/dom';

/**
 * On-device ride tracing (2026-07-06, device round 10). The desktop
 * harness — compositor fling, pixel screencast, latency and CPU
 * throttling — cannot reproduce what the phone shows, so the phone
 * itself records the evidence: the SAME per-frame invariants the e2e
 * recorder samples (scrollTop, coverage gap, anchor-vs-scrollTop
 * consistency, thread count, offset-ledger margin (with legacy transform
 * fallback), frame time, and settlement cause), in a ring buffer with a
 * one-tap export overlay.
 *
 * Enable on the device by opening the app once with `?ridetrace=1`
 * (persisted to localStorage; `?ridetrace=0` turns it off). Zero cost
 * when disabled: one localStorage read per timeline mount.
 *
 * The frame-time series is the discriminator the harness cannot get:
 * if the user sees a blank band while `gap` stays 0 and `dt` stays
 * ~16ms, the blank is raster starvation (compositor showed unrastered
 * tiles); if `dt` spikes, it is a main-thread stall; if `gap` is
 * non-zero, the virtualizer genuinely left the viewport uncovered.
 */

const RIDE_TRACE_STORAGE_KEY = 'mindroom.debug.ridetrace';
// ~45s at 60fps; short keys keep the export around a few hundred KB.
const RIDE_TRACE_MAX_FRAMES = 2_700;

type RideTraceFrame = {
  t: number;
  dt: number;
  st: number;
  sh: number;
  gap: number;
  jump: number;
  tc: number;
  tr: number;
  touch: 0 | 1;
  // Cumulative ledger-settle cause counters. A change between adjacent
  // frames attributes the scrollTop/margin rebase in that interval.
  lq: number;
  lb: number;
};

export const bootstrapRideTraceFlagFromUrl = (): void => {
  try {
    const value = new URLSearchParams(window.location.search).get('ridetrace');
    if (value === '1') localStorage.setItem(RIDE_TRACE_STORAGE_KEY, '1');
    if (value === '0') localStorage.removeItem(RIDE_TRACE_STORAGE_KEY);
  } catch {
    // storage unavailable — recorder stays off
  }
};

export const isRideTraceEnabled = (): boolean => {
  try {
    return localStorage.getItem(RIDE_TRACE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const readTransformPx = (inner: HTMLElement | null): number => {
  if (!inner) return 0;
  // Ledger margin (round 10) with the legacy transform as fallback so a
  // trace from any deployed build reads correctly.
  const margin = Number.parseFloat(inner.style.marginTop);
  if (!Number.isNaN(margin) && margin !== 0) return Math.round(margin);
  const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(inner.style.transform);
  return match ? Math.round(Number(match[1])) : 0;
};

// Traces get pasted into issue trackers and chat: identify the browser
// only as a coarse form factor, and rooms/threads only as short one-way
// hashes — correlatable across traces from the same room, but not
// reversible to the room id (adversarial review 2026-07-07, periphery F3).
const readFormFactor = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'ios';
  // isIOSWebKitDevice is the vetted family probe (covers iPad UAs and the
  // iPadOS desktop-mode MacIntel masquerade without deprecated
  // navigator.platform reads); iPhone/iPod are matched above, so a hit
  // here is iPad-shaped.
  if (isIOSWebKitDevice()) return 'ipados';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
};

// FNV-1a 32-bit, hex. Not cryptographic; short and stable is the point.
const shortTraceHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const installRideTraceRecorder = (
  scroller: HTMLElement,
  getInner: () => HTMLElement | null,
  context: { roomId: string; threadId?: string }
): (() => void) => {
  const frames: RideTraceFrame[] = [];
  // Ring write index: push+shift turns O(n) per frame once the buffer
  // fills (~45s in), and the recorder must not manufacture the dt spikes
  // it exists to attribute on low-end devices (periphery F4).
  let frameWriteIndex = 0;
  let anchor: Element | null = null;
  let anchorTop = 0;
  let lastScrollTop = scroller.scrollTop;
  let lastT = performance.now();
  let stopped = false;

  const readThreadCount = () =>
    Number(
      (scroller.querySelector('[data-thread-count]') as HTMLElement | null)?.dataset.threadCount ??
        -1
    );
  const readGap = (): number => {
    const rect = scroller.getBoundingClientRect();
    const top = rect.top + rect.height * 0.1;
    const bottom = rect.bottom - rect.height * 0.1;
    const tiles = Array.from(scroller.querySelectorAll('[data-index]'))
      .map((tile) => tile.getBoundingClientRect())
      .filter((r) => r.bottom > top && r.top < bottom)
      .sort((a, b) => a.top - b.top);
    let cursor = top;
    let maxGap = 0;
    tiles.forEach((r) => {
      if (r.top > cursor) maxGap = Math.max(maxGap, r.top - cursor);
      cursor = Math.max(cursor, r.bottom);
    });
    if (cursor < bottom) maxGap = Math.max(maxGap, bottom - cursor);
    return Math.round(maxGap);
  };
  const pickAnchor = (): Element | null => {
    const rows = Array.from(scroller.querySelectorAll('[data-message-item]'));
    const mid = window.innerHeight / 2;
    let best: Element | null = null;
    let bestDistance = Infinity;
    rows.forEach((r) => {
      const rect = r.getBoundingClientRect();
      const distance = Math.abs((rect.top + rect.bottom) / 2 - mid);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = r;
      }
    });
    return best;
  };

  const loop = () => {
    if (stopped) return;
    const t = performance.now();
    const scrollTop = scroller.scrollTop;
    let jump = 0;
    if (anchor && anchor.isConnected) {
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom > -1200 && rect.top < window.innerHeight + 1200) {
        jump = Math.abs(rect.top - anchorTop + (scrollTop - lastScrollTop));
        anchorTop = rect.top;
      } else {
        anchor = pickAnchor();
        anchorTop = anchor?.getBoundingClientRect().top ?? 0;
      }
    } else {
      anchor = pickAnchor();
      anchorTop = anchor?.getBoundingClientRect().top ?? 0;
    }
    frames[frameWriteIndex % RIDE_TRACE_MAX_FRAMES] = {
      t: Math.round(t),
      dt: Math.round(t - lastT),
      st: Math.round(scrollTop),
      sh: Math.round(scroller.scrollHeight),
      gap: readGap(),
      jump: Math.round(jump),
      tc: readThreadCount(),
      tr: readTransformPx(getInner()),
      touch: hasActiveWindowTouches() ? 1 : 0,
      lq: getCacheProbeCounter('ledgerQuiescenceSettles'),
      lb: getCacheProbeCounter('ledgerBoundarySettles'),
    };
    frameWriteIndex += 1;
    lastScrollTop = scrollTop;
    lastT = t;
    window.requestAnimationFrame(loop);
  };
  window.requestAnimationFrame(loop);

  const orderedFrames = (): RideTraceFrame[] => {
    if (frameWriteIndex <= RIDE_TRACE_MAX_FRAMES) return frames.slice(0, frameWriteIndex);
    const splitAt = frameWriteIndex % RIDE_TRACE_MAX_FRAMES;
    return [...frames.slice(splitAt), ...frames.slice(0, splitAt)];
  };

  const buildExport = () =>
    JSON.stringify({
      kind: 'mindroom-ride-trace',
      version: 3,
      capturedAt: new Date().toISOString(),
      formFactor: readFormFactor(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      roomHash: shortTraceHash(context.roomId),
      threadHash: context.threadId ? shortTraceHash(context.threadId) : null,
      probes: getCacheProbeSnapshot(),
      frames: orderedFrames(),
    });

  const overlay = document.createElement('button');
  overlay.textContent = `TRACE ● ${context.threadId ? 'thread' : 'room'}`;
  overlay.setAttribute('data-ride-trace-overlay', '1');
  overlay.style.cssText = [
    'position:fixed',
    'left:8px',
    'bottom:96px',
    'z-index:99999',
    'padding:6px 10px',
    'border-radius:8px',
    'border:1px solid #c33',
    'background:rgba(200,40,40,0.85)',
    'color:#fff',
    'font:12px/1.2 monospace',
  ].join(';');
  overlay.onclick = async () => {
    const payload = buildExport();
    try {
      const file = new File([payload], `ride-trace-${Date.now()}.json`, {
        type: 'application/json',
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'MindRoom ride trace' });
        overlay.textContent = 'TRACE shared ✓';
        return;
      }
    } catch {
      // fall through to clipboard
    }
    if (await copyToClipboard(payload)) {
      overlay.textContent = `TRACE copied ✓ (${Math.round(payload.length / 1024)}KB)`;
      return;
    }

    console.log('[ride-trace]', payload);
    overlay.textContent = 'TRACE in console';
  };
  document.body.appendChild(overlay);

  return () => {
    stopped = true;
    overlay.remove();
  };
};
