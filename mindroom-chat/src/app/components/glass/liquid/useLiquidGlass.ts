import { Ref, RefCallback, useCallback, useEffect, useRef } from 'react';
import { attachLiquidGlass } from './liquidGlass';

export const useLiquidGlass = <T extends HTMLElement>(
  forwardedRef?: Ref<T>,
  enabled = true,
  { refraction = true }: { refraction?: boolean } = {}
): RefCallback<T> => {
  const element = useRef<T | null>(null);
  const cleanup = useRef<(() => void) | undefined>();
  useEffect(() => {
    // React 18 StrictMode replays effects without replaying DOM refs.
    if (enabled && element.current && !cleanup.current) {
      cleanup.current = attachLiquidGlass(element.current, { refraction });
    }
    return () => {
      cleanup.current?.();
      cleanup.current = undefined;
    };
  }, [enabled, refraction]);

  return useCallback(
    (node: T | null) => {
      cleanup.current?.();
      cleanup.current = undefined;
      element.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: T | null }).current = node;
      if (enabled && node) cleanup.current = attachLiquidGlass(node, { refraction });
    },
    [enabled, forwardedRef, refraction]
  );
};

// Inline cards keep their native blur without allocating optical filters or observers.
export const useGlassHighlight = <T extends HTMLElement>(forwardedRef?: Ref<T>, enabled = true) =>
  useLiquidGlass(forwardedRef, enabled, { refraction: false });
