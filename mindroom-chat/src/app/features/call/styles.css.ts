import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

export const CallViewContent = style({
  padding: config.space.S400,
  paddingInlineEnd: 0,
  minHeight: '100%',
});

export const ControlCard = style({
  padding: config.space.S300,
});

export const ControlDivider = style({
  height: toRem(24),
});

export const CallMemberCard = style({
  padding: config.space.S300,
});

export const CallControlContainer = style({
  padding: config.space.S400,
});

export const PrescreenMessage = style({
  padding: config.space.S200,
});

export const CallJoined = style({
  position: 'relative',
  minHeight: 0,
});

export const CallFailureBanner = style({
  position: 'absolute',
  zIndex: 2,
  top: config.space.S400,
  left: '50%',
  width: `calc(100% - ${toRem(32)})`,
  maxWidth: toRem(720),
  transform: 'translateX(-50%)',
  padding: config.space.S400,
  borderRadius: config.radii.R400,
  boxShadow: config.shadow.E200,
});
