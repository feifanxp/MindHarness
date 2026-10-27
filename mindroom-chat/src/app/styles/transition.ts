import { motion } from './Motion.css';

/**
 * Builds a `transition` shorthand for one or more properties on the same
 * timing, which is what nearly every call site wants.
 *
 * This is a plain module rather than part of `Motion.css.ts` because
 * vanilla-extract only lets a `.css.ts` file export values it can serialize
 * into the build output, and a function is not one of them once a regular
 * module imports it. The tokens it reads are just CSS variable references, so
 * they cross that boundary fine.
 */
export const transition = (
  properties: string[],
  duration: string = motion.duration.Fast,
  easing: string = motion.easing.Standard
): string => properties.map((property) => `${property} ${duration} ${easing}`).join(', ');
