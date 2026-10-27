import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Waveform = style([
  DefaultReset,
  {
    display: 'block',
    direction: 'ltr',
    width: '100%',
    minWidth: `min(${toRem(96)}, 100%)`,
    height: toRem(32),
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const WaveformSeek = style({
  position: 'relative',
  cursor: 'pointer',
  borderRadius: config.radii.R300,
  ':focus-within': {
    outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
    outlineOffset: config.space.S100,
  },
});

// Native range supplies pointer capture, touch scrubbing and slider semantics.
export const SeekInput = style({
  position: 'absolute',
  inset: '50% 0 auto',
  width: '100%',
  height: toRem(44),
  transform: 'translateY(-50%)',
  margin: 0,
  opacity: 0,
  cursor: 'pointer',
  ':disabled': { cursor: 'default' },
});

export const WaveformDimmed = style({
  opacity: config.opacity.P500,
});

export const WaveformCompact = style({
  display: 'flex',
  justifyContent: 'flex-end',
  overflow: 'hidden',
  position: 'relative',
  backgroundImage: `linear-gradient(to right, transparent 0 ${toRem(1)}, ${
    color.SurfaceVariant.ContainerLine
  } ${toRem(1)} ${toRem(3)})`,
  backgroundPosition: 'right center',
  backgroundRepeat: 'repeat-x',
  backgroundSize: `${toRem(3)} ${toRem(3)}`,
});

export const Svg = style({
  display: 'block',
  width: '100%',
  height: '100%',
});

export const SvgCompact = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineEnd: 0,
  flex: '0 0 auto',
  width: 'auto',
  maxWidth: 'none',
});

export const Bar = style({
  fill: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P400,
});

export const BarCompact = style({
  fill: color.Surface.OnContainer,
  opacity: 1,
});

export const BarActive = style({
  fill: color.Primary.Main,
  opacity: 1,
});

export const BarCompactUnrecorded = style({
  fill: color.SurfaceVariant.ContainerLine,
  opacity: 1,
});
