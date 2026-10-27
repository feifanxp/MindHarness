import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const Trigger = style({ position: 'relative' });
export const Count = style({ position: 'absolute', insetInlineStart: 3, top: 3 });
export const Dialog = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
export const Header = style({
  paddingBlock: 0,
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S200,
  borderBottomWidth: config.borderWidth.B300,
  flexShrink: 0,
});
export const Content = style({ padding: config.space.S400 });
export const Card = style({
  padding: config.space.S400,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R400,
  minWidth: 0,
});
export const Wrap = style({ overflowWrap: 'anywhere', minWidth: 0 });
export const Prompt = style([Wrap, { whiteSpace: 'pre-wrap', lineHeight: 1.5 }]);
export const Metadata = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: `${config.space.S100} ${config.space.S300}`,
  margin: 0,
});
export const Awaiting = style({ color: color.Warning.Main });
export const Empty = style({ padding: `${config.space.S600} 0`, textAlign: 'center' });
