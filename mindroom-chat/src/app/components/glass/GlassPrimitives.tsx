import React, { ComponentProps, Ref } from 'react';
import classNames from 'classnames';
import {
  ContainerColor,
  Chip as FoldsChip,
  Dialog as FoldsDialog,
  Header as FoldsHeader,
  IconButton as FoldsIconButton,
  Menu as FoldsMenu,
  MenuItem as FoldsMenuItem,
  Modal as FoldsModal,
  as,
} from 'folds';
import { ContainerColor as containerColor } from '../../styles/ContainerColor.css';
import {
  glassFlat,
  glassFloating,
  glassInheritTint,
  glassOutline,
  glassScrollPanel,
  glassSurface,
} from '../../styles/Glass.css';
import { useLiquidGlass } from './liquid/useLiquidGlass';
import {
  ScrollHeaderProvider,
  SurfaceProvider,
  useScrollHeaderContext,
  useSurfaceContext,
} from './SurfaceContext';
import { inheritSurface } from './Surface.css';

export type SurfaceAppearance = 'glass' | 'plain' | 'inherit';
type AppearanceProps = { appearance?: SurfaceAppearance };
type SurfaceLevel = 'overlay' | 'panel' | 'control';

const useSurface = (
  ref: Ref<HTMLElement> | undefined,
  appearance: SurfaceAppearance,
  level: SurfaceLevel,
  variant: ContainerColor
) => {
  const enclosingSurface = useSurfaceContext();
  const glass = appearance === 'glass';
  return {
    ref: useLiquidGlass(ref, glass),
    className: classNames(
      glass && glassSurface({ level, variant }),
      appearance === 'inherit' && inheritSurface
    ),
    context: glass || (appearance === 'inherit' && enclosingSurface),
  };
};

type SurfaceProps = AppearanceProps & { level?: SurfaceLevel; variant?: ContainerColor };

type IconButtonProps = Pick<
  ComponentProps<typeof FoldsIconButton>,
  'variant' | 'size' | 'radii' | 'outlined'
>;

// Small controls share the material without an optical filter or observer per button.
export const IconButton = as<'button', IconButtonProps>(
  ({ className, variant = 'SurfaceVariant', ...props }, ref) => (
    <FoldsIconButton
      {...props}
      ref={ref}
      variant={variant}
      className={classNames(glassSurface({ level: 'control', variant }), className)}
    />
  )
);

type ChipProps = Pick<
  ComponentProps<typeof FoldsChip>,
  'variant' | 'size' | 'radii' | 'before' | 'after'
>;

export const Chip = as<'button', ChipProps>(
  ({ className, variant = 'SurfaceVariant', ...props }, ref) => (
    <FoldsChip
      {...props}
      ref={ref}
      variant={variant}
      className={classNames(
        glassSurface({ level: 'control', variant }),
        glassFloating,
        glassOutline,
        className
      )}
    />
  )
);

/** Shared material for custom floating panels; preserves the caller's DOM element. */
export const Surface = as<'div', SurfaceProps>(
  (
    {
      as: As = 'div',
      appearance = 'glass',
      level = 'overlay',
      variant = 'Surface',
      className,
      ...props
    },
    ref
  ) => {
    const surface = useSurface(ref, appearance, level, variant);
    return (
      <ScrollHeaderProvider value={false}>
        <SurfaceProvider value={surface.context}>
          <As
            {...props}
            ref={surface.ref}
            className={classNames(
              containerColor({ variant }),
              surface.className,
              appearance === 'glass' && level === 'overlay' && glassScrollPanel,
              appearance === 'glass' && level === 'overlay' && glassFloating,
              className
            )}
          />
        </SurfaceProvider>
      </ScrollHeaderProvider>
    );
  }
);

type MenuProps = Pick<ComponentProps<typeof FoldsMenu>, 'variant'> & AppearanceProps;
export const Menu = as<'div', MenuProps>(
  ({ className, variant = 'Surface', appearance = 'glass', ...props }, ref) => {
    const surface = useSurface(ref, appearance, 'overlay', variant);
    return (
      <ScrollHeaderProvider value={false}>
        <SurfaceProvider value={surface.context}>
          <FoldsMenu
            {...props}
            ref={surface.ref}
            variant={variant}
            className={classNames(
              surface.className,
              appearance === 'glass' && glassScrollPanel,
              appearance === 'glass' && glassFloating,
              className
            )}
          />
        </SurfaceProvider>
      </ScrollHeaderProvider>
    );
  }
);

type ModalProps = Pick<ComponentProps<typeof FoldsModal>, 'variant' | 'size' | 'flexHeight'> &
  AppearanceProps;
export const Modal = as<'div', ModalProps>(
  ({ className, variant = 'Surface', appearance = 'glass', ...props }, ref) => {
    const surface = useSurface(ref, appearance, 'overlay', variant);
    return (
      <ScrollHeaderProvider value={false}>
        <SurfaceProvider value={surface.context}>
          <FoldsModal
            {...props}
            ref={surface.ref}
            variant={variant}
            className={classNames(
              surface.className,
              appearance === 'glass' && glassScrollPanel,
              className
            )}
          />
        </SurfaceProvider>
      </ScrollHeaderProvider>
    );
  }
);

type DialogProps = Pick<ComponentProps<typeof FoldsDialog>, 'variant'> & AppearanceProps;
export const Dialog = as<'div', DialogProps>(
  ({ className, variant = 'Surface', appearance = 'glass', ...props }, ref) => {
    const surface = useSurface(ref, appearance, 'overlay', variant);
    return (
      <ScrollHeaderProvider value={false}>
        <SurfaceProvider value={surface.context}>
          <FoldsDialog
            {...props}
            ref={surface.ref}
            variant={variant}
            className={classNames(
              surface.className,
              appearance === 'glass' && glassScrollPanel,
              className
            )}
          />
        </SurfaceProvider>
      </ScrollHeaderProvider>
    );
  }
);

type HeaderProps = Pick<ComponentProps<typeof FoldsHeader>, 'variant' | 'size'> &
  AppearanceProps & { flat?: boolean };
export const Header = as<'header', HeaderProps>(
  ({ className, variant = 'Surface', appearance, flat, ...props }, ref) => {
    const enclosingSurface = useSurfaceContext();
    const scrollHeader = useScrollHeaderContext();
    // Semantic foregrounds need their matching fill to retain text contrast.
    const neutral = ['Background', 'Surface', 'SurfaceVariant'].includes(variant);
    // A neutral header outside any surface is page chrome: flat, without a raised rim or border.
    const isFlat = flat ?? (scrollHeader || (!enclosingSurface && !appearance && neutral));
    const surface = useSurface(
      ref,
      isFlat ? 'plain' : appearance ?? (enclosingSurface && neutral ? 'inherit' : 'glass'),
      'panel',
      variant
    );
    return (
      <ScrollHeaderProvider value={false}>
        <SurfaceProvider value={isFlat || surface.context}>
          <FoldsHeader
            {...props}
            data-glass-flat={isFlat || undefined}
            ref={surface.ref}
            variant={variant}
            className={classNames(
              surface.className,
              isFlat && glassSurface({ level: 'panel', variant }),
              isFlat && glassFlat,
              isFlat && glassFloating,
              isFlat && enclosingSurface && neutral && glassInheritTint,
              className
            )}
          />
        </SurfaceProvider>
      </ScrollHeaderProvider>
    );
  }
);

// Menu rows must leave the material behind them visible; explicit soft fills
// still provide semantic selection and emphasis where callers request them.
type MenuItemProps = Pick<
  ComponentProps<typeof FoldsMenuItem>,
  'variant' | 'fill' | 'size' | 'radii' | 'before' | 'after'
>;
export const MenuItem = as<'button', MenuItemProps>(({ fill = 'None', ...props }, ref) => (
  <FoldsMenuItem {...props} fill={fill} ref={ref} />
));
