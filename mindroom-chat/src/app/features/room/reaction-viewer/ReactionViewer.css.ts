import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

export const ReactionViewer = style([
  DefaultReset,
  {
    height: '100%',
  },
]);

export const Sidebar = style({
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
});
export const SidebarContent = style({
  padding: config.space.S200,
  paddingInlineEnd: 0,
});

export const Header = style({
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S300,

  flexShrink: 0,
  gap: config.space.S200,
});

export const Content = style({
  paddingInlineStart: config.space.S200,
  paddingBottom: config.space.S400,
});
