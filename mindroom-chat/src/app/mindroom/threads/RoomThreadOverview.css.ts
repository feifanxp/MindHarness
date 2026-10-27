import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../../styles/Motion.css';
import { transition } from '../../styles/transition';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

export const Overview = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    margin: `${config.space.S200} ${config.space.S300}`,
    padding: config.space.S200,
    borderRadius: config.radii.R400,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    flexShrink: 0,
  },
]);

export const ToolbarHeader = style({
  display: 'flex',
  // Wrap between groups when the room is narrow; groups themselves never
  // break apart (see ToggleGroup), so controls stay in recognizable rows.
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

export const ToggleGroup = style({
  display: 'flex',
  flexWrap: 'nowrap',
  flexShrink: 0,
  alignItems: 'center',
  gap: config.space.S100,
});

export const CompactCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  cursor: 'default',
});

const TOGGLE_SIZE = toRem(32);

export const ToggleButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: TOGGLE_SIZE,
  height: TOGGLE_SIZE,
  minWidth: TOGGLE_SIZE,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  padding: 0,
  position: 'relative',
  overflow: 'hidden',
  opacity: config.opacity.P300,
  transition: transition(['background-color', 'border-color', 'opacity'], motion.duration.Normal),

  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const ToggleInclude = style({
  backgroundColor: color.Success.Container,
  borderColor: color.Success.ContainerLine,
  color: color.Success.OnContainer,
  opacity: '1',

  selectors: {
    '&:hover': {
      backgroundColor: color.Success.ContainerHover,
    },
  },
});

export const ToggleIncludeOr = style({
  backgroundColor: color.Warning.Container,
  borderColor: color.Warning.ContainerLine,
  color: color.Warning.OnContainer,
  opacity: '1',

  selectors: {
    '&:hover': {
      backgroundColor: color.Warning.ContainerHover,
    },
  },
});

export const ToggleExclude = style({
  backgroundColor: color.Critical.Container,
  borderColor: color.Critical.ContainerLine,
  color: color.Critical.OnContainer,
  opacity: '1',

  selectors: {
    '&:hover': {
      backgroundColor: color.Critical.ContainerHover,
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: '140%',
      height: toRem(2),
      backgroundColor: color.Critical.Main,
      transform: 'translate(-50%, -50%) rotate(-45deg)',
      pointerEvents: 'none',
    },
  },
});

export const SortButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: config.space.S100,
  height: TOGGLE_SIZE,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),

  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const SortButtonActive = style({
  backgroundColor: color.Primary.Container,
  borderColor: color.Primary.ContainerLine,
  color: color.Primary.OnContainer,

  selectors: {
    '&:hover': {
      backgroundColor: color.Primary.ContainerHover,
    },
  },
});

export const PauseButtonActive = style({
  backgroundColor: color.Warning.Container,
  borderColor: color.Warning.ContainerLine,
  color: color.Warning.OnContainer,
  opacity: '1',

  selectors: {
    '&:hover': {
      backgroundColor: color.Warning.ContainerHover,
    },
  },
});

// ─── Tag filters (right side of toolbar) ────────────────────────────────────

export const TagRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: config.space.S100,
  marginInlineStart: 'auto',
  flexWrap: 'wrap',
});

export const TagList = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  flexWrap: 'wrap',
});

const TAG_PILL_HEIGHT = toRem(26);

export const TagPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: TAG_PILL_HEIGHT,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  overflow: 'hidden',
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),
});

export const TagPillInclude = style({
  backgroundColor: color.Success.Container,
  borderColor: color.Success.ContainerLine,
  color: color.Success.OnContainer,
});

export const TagPillExclude = style({
  backgroundColor: color.Critical.Container,
  borderColor: color.Critical.ContainerLine,
  color: color.Critical.OnContainer,
});

export const TagPillLabel = style({
  background: 'none',
  border: 'none',
  padding: `0 ${config.space.S200}`,
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      opacity: '0.8',
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
});

export const TagPillRemove = style({
  background: 'none',
  border: 'none',
  borderInlineStart: `${config.borderWidth.B300} solid currentColor`,
  padding: `0 ${config.space.S100}`,
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
  opacity: '0.6',
  height: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  selectors: {
    '&:hover': {
      opacity: '1',
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
});

export const AddTagContainer = style({
  position: 'relative',
  display: 'inline-flex',
});

export const AddTagButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: TAG_PILL_HEIGHT,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  opacity: config.opacity.P300,
  transition: transition(['opacity'], motion.duration.Normal),
  font: 'inherit',
  selectors: {
    '&:hover': {
      opacity: '1',
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const AddTagDropdown = style({
  position: 'absolute',
  top: `calc(${TAG_PILL_HEIGHT} + ${config.space.S100})`,
  insetInlineEnd: 0,
  zIndex: 100,
  minWidth: toRem(140),
  maxHeight: toRem(200),
  overflowY: 'auto',
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: config.space.S100,
});

export const AddTagOption = style({
  display: 'block',
  width: '100%',
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: 'none',
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  textAlign: 'start',
  font: 'inherit',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
});

// ─── Preset dropdown ────────────────────────────────────────────────────────

export const PresetContainer = style({
  position: 'relative',
  display: 'inline-flex',
  flexShrink: 0,
});

export const PresetButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  height: TOGGLE_SIZE,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  font: 'inherit',
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const PresetDropdown = style({
  position: 'absolute',
  top: `calc(${TOGGLE_SIZE} + ${config.space.S100})`,
  insetInlineStart: 0,
  zIndex: 200,
  minWidth: toRem(180),
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: config.space.S100,
});

export const PresetOption = style({
  display: 'block',
  width: '100%',
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: 'none',
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  textAlign: 'start',
  font: 'inherit',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
});

// ─── Info popover ───────────────────────────────────────────────────────────

export const InfoContainer = style({
  position: 'relative',
  display: 'inline-flex',
  flexShrink: 0,
});

export const InfoButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: TOGGLE_SIZE,
  height: TOGGLE_SIZE,
  minWidth: TOGGLE_SIZE,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
  transition: transition(['background-color'], motion.duration.Normal),
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const InfoPopover = style({
  position: 'absolute',
  top: `calc(${TOGGLE_SIZE} + ${config.space.S100})`,
  insetInlineEnd: 0,
  zIndex: 200,
  minWidth: toRem(220),
  maxWidth: toRem(300),
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const InfoStatRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${toRem(2)} 0`,
});

export const InfoSectionDivider = style({
  height: config.borderWidth.B300,
  backgroundColor: color.SurfaceVariant.ContainerLine,
  margin: `${config.space.S200} 0`,
});

// ─── Search bar ─────────────────────────────────────────────────────────────

export const SearchContainer = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
});

export const SearchInput = style({
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: toRem(13),
  outline: 'none',
  width: toRem(140),
  maxWidth: toRem(200),
  padding: `0 ${config.space.S200}`,
  height: TOGGLE_SIZE,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  selectors: {
    '&::placeholder': {
      color: color.SurfaceVariant.OnContainer,
      opacity: '0.5',
    },
    '&:focus': {
      borderBottomColor: color.Primary.Main,
    },
  },
});

// ─── Empty state ────────────────────────────────────────────────────────────

export const EmptyState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: config.space.S200,
  padding: `${config.space.S400} ${config.space.S200}`,
  color: color.SurfaceVariant.OnContainer,
});

export const ResetLink = style({
  color: color.Primary.Main,
  cursor: 'pointer',
  textDecoration: 'underline',
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});
