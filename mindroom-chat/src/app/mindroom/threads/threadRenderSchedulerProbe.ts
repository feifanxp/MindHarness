type Sample = { source: 1 | 2 | 3; delayMs: number; visible: boolean };

/** One callback per scheduling path: 1 = timer, 2 = animation frame, 3 = message channel. */
export const observeThreadRenderScheduler = (report: (sample: Sample) => void): (() => void) => {
  const startedAt = performance.now();
  let disposed = false;
  const sample = (source: Sample['source']) => {
    if (disposed) return;
    try {
      report({
        source,
        delayMs: Math.max(0, performance.now() - startedAt),
        visible: document.visibilityState === 'visible',
      });
    } catch {
      // Diagnostic observers must never disrupt the application's callbacks.
    }
  };
  const timer = setTimeout(() => sample(1), 0);
  const frame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => sample(2))
      : undefined;
  let channel: MessageChannel | undefined;
  try {
    channel = new MessageChannel();
    channel.port1.onmessage = () => {
      sample(3);
      channel?.port1.close();
      channel?.port2.close();
    };
    channel.port2.postMessage(null);
  } catch {
    // The timer/frame observations remain useful if channel creation fails.
  }
  return () => {
    disposed = true;
    clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    channel?.port1.close();
    channel?.port2.close();
  };
};
