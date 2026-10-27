import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const ComposerRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  padding: `${config.space.S100} ${config.space.S200} 0`,
});
export const ScopeLabel = style({
  flexShrink: 0,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(11),
  lineHeight: toRem(16),
  '@media': { '(max-width: 360px)': { display: 'none' } },
});
export const Trigger = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  maxWidth: '100%',
  minHeight: toRem(28),
  padding: `${toRem(4)} ${toRem(9)}`,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: toRem(999),
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(12),
  cursor: 'pointer',
  ':hover': { background: color.SurfaceVariant.ContainerHover },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 2 },
});
export const TriggerLabel = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const TriggerIcon = style({ flexShrink: 0 });
export const Panel = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: 'min(22rem, calc(100vw - 16px))',
  maxWidth: 'calc(100vw - 16px)',
  maxHeight: 'min(35rem, calc(100dvh - 32px))',
  overflow: 'hidden',
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R400,
  color: color.Surface.OnContainer,
});
export const MobileContainer = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  width: '100vw',
  minHeight: '100svh',
  height: '100dvh',
});
export const MobilePanel = style({
  width: '100vw',
  maxWidth: '100vw',
  maxHeight: 'min(85svh, 42rem)',
  borderRadius: `${config.radii.R400} ${config.radii.R400} 0 0`,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});
export const Controls = style({
  height: 'auto',
  flexDirection: 'column',
  alignItems: 'stretch',
});
export const Header = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S200,
  flexShrink: 0,
  padding: `${config.space.S300} ${config.space.S300} ${config.space.S200}`,
});
export const HeaderText = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minWidth: 0,
});
export const Title = style({ fontSize: toRem(15), fontWeight: 600, lineHeight: toRem(22) });
export const Subtitle = style({
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(12),
  lineHeight: toRem(18),
});
export const IconButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: toRem(32),
  height: toRem(32),
  padding: 0,
  border: 0,
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  ':hover': { background: color.Surface.ContainerHover },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: -2 },
  '@media': { '(max-width: 750px)': { width: toRem(44), height: toRem(44) } },
});
export const SearchRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  flexShrink: 0,
  margin: `0 ${config.space.S300} ${config.space.S200}`,
  padding: `0 ${config.space.S200}`,
  minHeight: toRem(38),
  border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  selectors: { '&:focus-within': { borderColor: color.Primary.Main } },
});
export const SearchInput = style({
  flex: '1 1 auto',
  minWidth: 0,
  padding: `${toRem(8)} 0`,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(14),
});
export const RuntimeRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  flexShrink: 0,
  padding: `0 ${config.space.S300} ${config.space.S200}`,
});
export const RuntimeLabel = style({
  flexShrink: 0,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(12),
});
export const RuntimeSelect = style({
  flex: '1 1 auto',
  minWidth: 0,
  padding: `${toRem(7)} ${toRem(8)}`,
  border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(12),
});
export const StatusRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  padding: `0 ${config.space.S300} ${config.space.S200}`,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(12),
});
export const Error = style({
  margin: `0 ${config.space.S300} ${config.space.S200}`,
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  background: color.Critical.Container,
  color: color.Critical.OnContainer,
  fontSize: toRem(12),
  lineHeight: toRem(18),
});
export const ErrorActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  marginTop: config.space.S100,
});
export const TextButton = style({
  padding: `${toRem(5)} ${toRem(8)}`,
  border: `1px solid currentColor`,
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 2 },
});
export const Results = style({
  flex: '1 1 auto',
  minHeight: toRem(120),
  padding: `${config.space.S100} ${config.space.S200} ${config.space.S200}`,
});
export const Group = style({ selectors: { '& + &': { marginTop: config.space.S200 } } });
export const GroupTitle = style({
  padding: `${config.space.S100} ${config.space.S200}`,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(11),
  fontWeight: 600,
  lineHeight: toRem(16),
  letterSpacing: '0.04em',
});
export const Option = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minHeight: toRem(52),
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  outline: 0,
  cursor: 'pointer',
  ':hover': { background: color.Surface.ContainerHover },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: -2 },
  selectors: {
    '&[data-active="true"]': { background: color.Surface.ContainerHover },
    '&[aria-selected="true"]': {
      background: color.Primary.Container,
      color: color.Primary.OnContainer,
    },
    '&[aria-disabled="true"]': { cursor: 'default', opacity: 0.6 },
  },
});
export const OptionIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: toRem(30),
  height: toRem(30),
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
});
export const IconImage = style({ display: 'block', objectFit: 'cover', borderRadius: '50%' });
export const OptionText = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minWidth: 0,
});
export const OptionTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: toRem(13),
  fontWeight: 500,
  lineHeight: toRem(19),
});
export const OptionDetail = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(11),
  lineHeight: toRem(16),
});
export const Check = style({ flexShrink: 0, color: color.Primary.Main });
export const Empty = style({
  padding: `${config.space.S400} ${config.space.S300}`,
  color: color.SurfaceVariant.OnContainer,
  textAlign: 'center',
  fontSize: toRem(13),
});
export const Footer = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  flexShrink: 0,
  minHeight: toRem(42),
  padding: `${config.space.S100} ${config.space.S300}`,
  borderTop: `1px solid ${color.Surface.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(11),
});
export const FooterText = style({
  flex: '1 1 auto',
  minWidth: 0,
  maxHeight: toRem(48),
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});
