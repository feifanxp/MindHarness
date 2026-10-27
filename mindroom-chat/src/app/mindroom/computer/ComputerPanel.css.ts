import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export { Header, Panel } from '../sidebar/SidePanel.css';

export const Body = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  gap: config.space.S300,
  minHeight: 0,
  padding: config.space.S300,
});

export const ScreenFrame = style({
  alignItems: 'center',
  background: '#111',
  borderRadius: config.radii.R300,
  display: 'flex',
  flex: '1 1 auto',
  justifyContent: 'center',
  minHeight: toRem(240),
  overflow: 'hidden',
});

export const Screen = style({
  alignItems: 'center',
  display: 'flex',
  height: '100%',
  justifyContent: 'center',
  minHeight: 0,
  outline: 'none',
  width: '100%',
  selectors: {
    '&:focus-visible': {
      boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Primary.Main}`,
    },
  },
});

globalStyle(`${Screen} canvas`, {
  maxHeight: '100%',
  maxWidth: '100%',
});

export const Status = style({
  color: color.Surface.OnContainer,
});

export const Error = style({
  color: color.Critical.Main,
});

export const Actions = style({
  display: 'flex',
  flex: '0 0 auto',
  flexWrap: 'wrap',
  gap: config.space.S200,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});

export const AgentSelect = style({
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  maxWidth: '100%',
  padding: `${config.space.S200} ${config.space.S300}`,
});
