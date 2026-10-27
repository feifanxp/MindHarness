import { createGlobalTheme } from '@vanilla-extract/css';

/**
 * Motion tokens.
 *
 * Before these existed, every transition in the app picked its own duration
 * and curve by hand: 100ms linear, 120ms ease, 0.15s with no curve at all,
 * 200ms cubic-bezier(0, 0.8, 0.67, 0.97). Nothing was wrong individually, but
 * hovering across the sidebar, the thread list, and a message ran three
 * different speeds at three different accelerations.
 *
 * The duration steps are deliberately close to the values already in use, so
 * adopting them is a snap-to-grid rather than a re-timing. `Fast` and `Slow`
 * are exactly the two most common existing values.
 *
 * `Standard` is the curve for anything that both enters and leaves, which is
 * almost every hover and state change. `Decelerate` is for something arriving
 * and staying, `Accelerate` for something leaving for good. `Linear` is only
 * correct for continuous transforms such as a zoom that tracks a pointer.
 *
 * Respecting `prefers-reduced-motion` is not each caller's job for
 * transitions: `src/index.css` collapses every transition duration globally
 * under that query. Keyframe animations are not covered there, because some of
 * them are load-bearing (a frozen spinner says nothing), so those opt out one
 * at a time.
 *
 * The `transition()` helper that builds shorthands out of these lives in the
 * sibling `transition.ts`, not here: a `.css.ts` module may only export values
 * vanilla-extract can serialize, and a function is not one of them the moment a
 * plain `.tsx` imports it.
 */
export const motion = createGlobalTheme(':root', {
  duration: {
    Instant: '80ms',
    Fast: '120ms',
    Normal: '160ms',
    Slow: '200ms',
    Slower: '280ms',
  },
  easing: {
    Standard: 'cubic-bezier(0.2, 0, 0, 1)',
    Decelerate: 'cubic-bezier(0, 0, 0, 1)',
    Accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
    Linear: 'linear',
  },
});
