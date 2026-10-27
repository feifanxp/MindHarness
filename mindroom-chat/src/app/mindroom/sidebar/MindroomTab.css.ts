import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const LinkIndicator = style({
  width: toRem(16),
  height: toRem(16),
  borderRadius: '9999px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
  boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Success.ContainerLine}`,
});
