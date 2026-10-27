import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

export const PdfViewer = style([
  DefaultReset,
  {
    height: '100%',
  },
]);

export const PdfViewerHeader = style([
  DefaultReset,
  {
    paddingInlineStart: config.space.S200,
    paddingInlineEnd: config.space.S200,
    borderBottomWidth: config.borderWidth.B300,
    flexShrink: 0,
    gap: config.space.S200,
  },
]);
export const PdfViewerFooter = style([
  PdfViewerHeader,
  {
    borderTopWidth: config.borderWidth.B300,
    borderBottomWidth: 0,
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
]);

export const PdfViewerContent = style([
  DefaultReset,
  {
    margin: 'auto',
    display: 'inline-block',
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
  },
]);
