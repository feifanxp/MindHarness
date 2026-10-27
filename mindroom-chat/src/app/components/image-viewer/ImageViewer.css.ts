import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { motion } from '../../styles/Motion.css';
import { transition } from '../../styles/transition';

export const ImageViewer = style([
  DefaultReset,
  {
    height: '100%',
  },
]);

export const ImageViewerHeader = style([
  DefaultReset,
  {
    paddingInlineStart: config.space.S200,
    paddingInlineEnd: config.space.S200,
    borderBottomWidth: config.borderWidth.B300,
    flexShrink: 0,
    gap: config.space.S200,
  },
]);

export const ImageViewerContent = style([
  DefaultReset,
  {
    backgroundColor: color.Background.Container,
    color: color.Background.OnContainer,
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
  },
]);

export const ImageViewerImg = style([
  DefaultReset,
  {
    objectFit: 'contain',
    width: 'auto',
    height: 'auto',
    maxWidth: '100%',
    maxHeight: '100%',
    backgroundColor: color.Surface.Container,
    transition: transition(['transform'], motion.duration.Instant, motion.easing.Linear),
  },
]);
