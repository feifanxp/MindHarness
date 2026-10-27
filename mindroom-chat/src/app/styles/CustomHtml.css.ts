import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, DefaultReset, toRem } from 'folds';

export const MarginSpaced = style({
  marginBottom: config.space.S200,
  marginTop: config.space.S200,
  selectors: {
    '&:first-child': {
      marginTop: 0,
    },
    '&:last-child': {
      marginBottom: 0,
    },
  },
});

export const Paragraph = style([DefaultReset]);

export const Heading = style([
  DefaultReset,
  MarginSpaced,
  {
    marginTop: config.space.S400,
    selectors: {
      '&:first-child': {
        marginTop: 0,
      },
    },
  },
]);

export const BlockQuote = style([
  DefaultReset,
  MarginSpaced,
  {
    paddingInlineStart: config.space.S200,
    borderInlineStart: `${config.borderWidth.B700} solid ${color.SurfaceVariant.ContainerLine}`,
    fontStyle: 'italic',
  },
]);

const BaseCode = style({
  color: color.SurfaceVariant.OnContainer,
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
});
const CodeFont = style({
  direction: 'ltr',
  unicodeBidi: 'isolate',
  textAlign: 'left',
  fontFamily: 'var(--font-mono)',
});

export const Code = style([
  DefaultReset,
  BaseCode,
  CodeFont,
  {
    padding: `0 ${config.space.S100}`,
  },
]);

export const Spoiler = recipe({
  base: [
    DefaultReset,
    {
      padding: `0 ${config.space.S100}`,
      backgroundColor: color.SurfaceVariant.ContainerActive,
      borderRadius: config.radii.R300,
      selectors: {
        '&[aria-pressed=true]': {
          color: 'transparent',
        },
      },
    },
  ],
  variants: {
    active: {
      true: {
        color: 'transparent',
      },
    },
  },
});

export const CodeBlock = style([
  DefaultReset,
  BaseCode,
  MarginSpaced,
  {
    fontStyle: 'normal',
    position: 'relative',
    overflow: 'hidden',
  },
]);
// Message code blocks follow T3 Code: one surface with a quiet header row, the
// language as a colored icon, and icon-only actions. In dark themes the tint
// alone separates a block from the message; the composer keeps its border
// because the input field shares the block's tint.
export const MessageCodeBlock = style({
  selectors: {
    '.prism-dark &': {
      borderColor: 'transparent',
    },
  },
});
export const CodeBlockHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  paddingBlock: `${toRem(6)} 0`,
  paddingInline: `${config.space.S300} ${toRem(6)}`,
  userSelect: 'none',
});
export const CodeBlockLabel = style([
  CodeFont,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: toRem(6),
    minWidth: 0,
    fontSize: toRem(11),
    lineHeight: toRem(16),
    color: `color-mix(in srgb, ${color.SurfaceVariant.OnContainer} 72%, transparent)`,
  },
]);
export const CodeBlockLabelText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const CodeBlockLanguageIcon = style({
  flexShrink: 0,
  width: toRem(14),
  height: toRem(14),
  color: 'var(--mr-code-icon-light)',
  selectors: {
    '.prism-dark &': {
      color: 'var(--mr-code-icon-dark)',
    },
  },
});
export const CodeBlockActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: toRem(2),
  flexShrink: 0,
  '@media': {
    '(pointer: coarse)': {
      gap: config.space.S100,
    },
  },
});
export const CodeBlockAction = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(24),
    height: toRem(24),
    border: 'none',
    borderRadius: config.radii.R300,
    background: 'transparent',
    color: `color-mix(in srgb, ${color.SurfaceVariant.OnContainer} 64%, transparent)`,
    cursor: 'pointer',
    transition: 'background-color 120ms ease, color 120ms ease, scale 120ms ease',
    selectors: {
      '&[aria-pressed=true]': {
        backgroundColor: color.SurfaceVariant.ContainerActive,
        color: color.SurfaceVariant.OnContainer,
      },
      '&:active': {
        scale: '0.97',
      },
      '&:focus-visible': {
        outline: `2px solid ${color.Primary.Main}`,
        outlineOffset: '1px',
      },
    },
    '@media': {
      // Touch screens keep :hover after a tap, which would read as pressed.
      '(hover: hover)': {
        selectors: {
          '&:hover': {
            backgroundColor: color.SurfaceVariant.ContainerActive,
            color: color.SurfaceVariant.OnContainer,
          },
        },
      },
      '(pointer: coarse)': {
        width: toRem(32),
        height: toRem(32),
      },
    },
  },
]);
export const CodeBlockActionIcon = style({
  width: toRem(12),
  height: toRem(12),
  pointerEvents: 'none',
  '@media': {
    '(pointer: coarse)': {
      width: toRem(16),
      height: toRem(16),
    },
  },
});
// Virtualized messages mount many code blocks in one commit. Native overflow
// avoids measuring scrollbar geometry (and invalidating layout) for every block.
export const CodeBlockScroll = style({
  overflow: 'auto',
  padding: `${config.space.S100} ${config.space.S100} ${config.space.S300}`,
  scrollbarWidth: 'thin',
  scrollbarColor: `var(--mr-scrollbar-thumb-color, ${color.SurfaceVariant.ContainerLine}) transparent`,
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
  '::-webkit-scrollbar': {
    width: toRem(8),
    height: toRem(8),
  },
  '::-webkit-scrollbar-thumb': {
    backgroundColor: `var(--mr-scrollbar-thumb-color, ${color.SurfaceVariant.ContainerLine})`,
    borderRadius: config.radii.R300,
    border: '2px solid transparent',
    backgroundClip: 'padding-box',
  },
  '::-webkit-scrollbar-corner': {
    backgroundColor: 'transparent',
  },
  '::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
});
export const CodeBlockInternal = style([
  CodeFont,
  {
    padding: `${config.space.S200} ${config.space.S200} 0`,
    minWidth: toRem(200),
    selectors: {
      '[data-wrap=true] &': {
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      },
    },
  },
]);

// This marks a truncated code block, so it should fade INTO the block's own
// background the way CollapsibleGradientOverlay does for message bodies. The
// black veil it used to paint was invisible in midnight and read as grime on
// the light and butter code surfaces.
export const CodeBlockBottomShadow = style({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  pointerEvents: 'none',

  height: config.space.S400,
  background: `linear-gradient(to top, ${color.SurfaceVariant.Container}, transparent)`,
});

const BaseList = style({});
export const List = style([
  BaseList,
  DefaultReset,
  MarginSpaced,
  {
    padding: `0 ${config.space.S100}`,
    paddingInlineStart: config.space.S600,
    selectors: {
      '& &': {
        marginTop: config.space.S200,
        marginBottom: config.space.S200,
      },
      'li:last-child &': {
        marginBottom: 0,
      },
    },
  },
]);

export const Img = style([
  DefaultReset,
  MarginSpaced,
  {
    maxWidth: toRem(296),
    borderRadius: config.radii.R300,
  },
]);

export const InlineChromiumBugfix = style({
  fontSize: 0,
  lineHeight: 0,
});

export const Mention = recipe({
  base: [
    DefaultReset,
    {
      backgroundColor: color.SurfaceVariant.Container,
      color: color.SurfaceVariant.OnContainer,
      boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
      padding: `0 ${toRem(2)}`,
      borderRadius: config.radii.R300,
      fontWeight: config.fontWeight.W500,
    },
  ],
  variants: {
    highlight: {
      true: {
        backgroundColor: color.Success.Container,
        color: color.Success.OnContainer,
        boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Success.ContainerLine}`,
      },
    },
    focus: {
      true: {
        boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.OnContainer}`,
      },
    },
  },
});

export const Command = recipe({
  base: [
    DefaultReset,
    {
      padding: `0 ${toRem(2)}`,
      borderRadius: config.radii.R300,
      fontWeight: config.fontWeight.W500,
    },
  ],
  variants: {
    focus: {
      true: {
        boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Warning.OnContainer}`,
      },
    },
    active: {
      true: {
        backgroundColor: color.Warning.Container,
        color: color.Warning.OnContainer,
        boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Warning.ContainerLine}`,
      },
    },
  },
});

export const PasteMarker = recipe({
  base: [
    DefaultReset,
    {
      display: 'inline-flex',
      alignItems: 'center',
      maxWidth: '100%',
      gap: config.space.S100,
      padding: `0 ${config.space.S100}`,
      margin: `0 ${toRem(1)}`,
      borderRadius: config.radii.R300,
      backgroundColor: color.SurfaceVariant.Container,
      color: color.SurfaceVariant.OnContainer,
      boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
      fontWeight: config.fontWeight.W500,
      lineHeight: config.lineHeight.T300,
      whiteSpace: 'nowrap',
      verticalAlign: 'baseline',
    },
  ],
  variants: {
    focus: {
      true: {
        boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.OnContainer}`,
      },
    },
  },
});

export const PasteMarkerMeta = style({
  color: color.SurfaceVariant.OnContainer,
  fontWeight: config.fontWeight.W400,
  opacity: 0.72,
});

export const EmoticonBase = style([
  DefaultReset,
  {
    display: 'inline-block',
    padding: '0.05rem',
    height: '1em',
    verticalAlign: 'middle',
  },
]);

export const Emoticon = recipe({
  base: [
    DefaultReset,
    {
      display: 'inline-flex',
      justifyContent: 'center',
      alignItems: 'center',

      height: '1em',
      minWidth: '1em',
      fontSize: '1.33em',
      lineHeight: '1em',
      verticalAlign: 'middle',
      position: 'relative',
      top: '-0.35em',
      borderRadius: config.radii.R300,
    },
  ],
  variants: {
    focus: {
      true: {
        boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.OnContainer}`,
      },
    },
  },
});

export const EmoticonImg = style([
  DefaultReset,
  {
    height: '1em',
    cursor: 'default',
  },
]);

export const highlightText = style([
  DefaultReset,
  {
    backgroundColor: 'yellow',
    color: 'black',
  },
]);
