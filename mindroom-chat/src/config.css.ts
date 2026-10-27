import { createTheme } from '@vanilla-extract/css';
import { color, config } from 'folds';

// Modernized corner radii (folds defaults: 4px/8px/12px feel dated).
export const roundedRadii = createTheme(config.radii, {
  R0: '0',
  R300: '0.5rem',
  R400: '0.75rem',
  R500: '1.125rem',
  Round: '50%',
  Pill: '9999px',
});

// Softer, larger diffuse shadows than folds defaults (0 1px 6px / 0 1px 12px).
export const softShadow = createTheme(config.shadow, {
  E100: `0px 2px 8px -2px ${color.Other.Shadow}`,
  E200: `0px 4px 16px -4px ${color.Other.Shadow}`,
  E300: `0px 8px 24px -6px ${color.Other.Shadow}`,
  E400: `0px 12px 36px -8px ${color.Other.Shadow}`,
});

// Optical tracking. folds ships 0 for every step, which leaves large text
// looking loose and 12px text looking cramped. Larger type is tightened and
// only the smallest steps are opened up.
//
// The body steps T400 (15px) and T300 (14px) stay at 0 on purpose: they set
// the width of nearly every wrapped line in the timeline, and the virtualizer
// estimator in threadRenderUtils.ts is calibrated against their line counts.
// The button steps stay at 0 because widening a label can overflow a button.
// Every non-zero value below is negative except the three 12px steps, so the
// only steps that can grow are ones with slack around them.
export const opticalTracking = createTheme(config.letterSpacing, {
  D400: '-0.022em',
  H1: '-0.02em',
  H2: '-0.016em',
  H3: '-0.013em',
  H4: '-0.011em',
  H5: '-0.009em',
  H6: '-0.006em',
  T500: '-0.006em',
  T400: '0',
  T300: '0',
  T200: '0.004em',
  B500: '0',
  B400: '0',
  B300: '0',
  L400: '0.01em',
  O400: '0.004em',
  C400: '0.004em',
});

export const onLightFontWeight = createTheme(config.fontWeight, {
  W100: '100',
  W200: '200',
  W300: '300',
  W400: '400',
  W500: '500',
  W600: '600',
  W700: '700',
  W800: '800',
  W900: '900',
});

export const onDarkFontWeight = createTheme(config.fontWeight, {
  W100: '100',
  W200: '200',
  W300: '300',
  W400: '400',
  W500: '500',
  W600: '600',
  W700: '700',
  W800: '800',
  W900: '900',
});
