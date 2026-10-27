import React, { useEffect, useRef, type ComponentProps } from 'react';
import * as css from './ThreadIndicator.css';

// Compact rooms keep their cards mounted for fast scrolling.
// Share one observer so hundreds of offscreen pulses do not keep doing frame work.
let observer: IntersectionObserver | undefined;
const observedDots = new Set<HTMLSpanElement>();

const observeDot = (dot: HTMLSpanElement): (() => void) => {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        const element = target as HTMLSpanElement;
        if (!observedDots.has(element)) return;
        element.style.animationPlayState = isIntersecting ? 'running' : 'paused';
      });
    });
  }
  observedDots.add(dot);
  dot.style.animationPlayState = 'paused';
  observer.observe(dot);

  return () => {
    observer?.unobserve(dot);
    observedDots.delete(dot);
    if (observedDots.size === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  };
};

type ThreadStreamingDotProps = Pick<ComponentProps<'span'>, 'role' | 'aria-label' | 'aria-hidden'>;

export function ThreadStreamingDot(props: ThreadStreamingDotProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const dot = ref.current;
    return dot ? observeDot(dot) : undefined;
  }, []);

  return <span {...props} ref={ref} className={css.ThreadStreamingDot} />;
}
