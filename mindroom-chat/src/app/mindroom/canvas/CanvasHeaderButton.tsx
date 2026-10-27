import React, { MouseEventHandler, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  config,
  Icon,
  IconButton,
  Icons,
  PopOut,
  RectCords,
  Scroll,
  Text,
  toRem,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { stopPropagation } from '../../utils/keyboard';
import type { CanvasListEntry } from './canvasIndexStore';

// A conversation can have many canvases: the menu stays inside the viewport and scrolls its choices.
const CANVAS_MENU_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  maxWidth: toRem(320),
  width: '100vw',
  maxHeight: `calc(100vh - ${toRem(96)})`,
} as const;

type CanvasHeaderButtonProps = {
  /** The conversation's canvases, in the order to list them. */
  canvases: CanvasListEntry[];
  openCanvasId?: string;
  onOpen: (canvasId: string) => void;
  onClose: () => void;
};

/** Brings back a conversation's canvas: one toggles directly, several are chosen from a menu. */
export function CanvasHeaderButton({
  canvases,
  openCanvasId,
  onOpen,
  onClose,
}: CanvasHeaderButtonProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const date = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language]
  );
  const several = canvases.length > 1;
  // A menu that lost its choices must not come back with the next canvas.
  useEffect(() => {
    if (!several) setMenuAnchor(undefined);
  }, [several]);

  if (canvases.length === 0) return null;

  const open = canvases.some((canvas) => canvas.canvasId === openCanvasId);
  const toggle = (canvasId: string) => (canvasId === openCanvasId ? onClose() : onOpen(canvasId));
  const label = several
    ? t('mindroomUi.threads.mindroomRoomViewHeader.canvases')
    : t(
        open
          ? 'mindroomUi.threads.mindroomRoomViewHeader.hideCanvas'
          : 'mindroomUi.threads.mindroomRoomViewHeader.showCanvas'
      );
  const handleClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    if (several) setMenuAnchor(evt.currentTarget.getBoundingClientRect());
    else toggle(canvases[0].canvasId);
  };

  return (
    <>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          <Tooltip>
            <Text>{label}</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <IconButton
            fill="None"
            ref={triggerRef}
            onClick={handleClick}
            aria-label={label}
            aria-pressed={open}
          >
            <Icon size="400" src={Icons.Category} filled={open} />
          </IconButton>
        )}
      </TooltipProvider>
      <PopOut
        anchor={several ? menuAnchor : undefined}
        position="Bottom"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: true,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu style={CANVAS_MENU_STYLE}>
              <Box
                direction="Column"
                gap="100"
                style={{ padding: config.space.S100, minHeight: 0 }}
              >
                <Box style={{ padding: `${config.space.S100} ${config.space.S200}` }}>
                  <Text size="L400">{label}</Text>
                </Box>
                <Scroll size="300" hideTrack visibility="Hover">
                  <Box direction="Column" gap="100">
                    {canvases.map((canvas) => {
                      const current = canvas.canvasId === openCanvasId;
                      return (
                        <MenuItem
                          key={canvas.canvasId}
                          onClick={() => {
                            setMenuAnchor(undefined);
                            toggle(canvas.canvasId);
                          }}
                          aria-current={current ? 'true' : undefined}
                          size="400"
                          radii="300"
                          after={current ? <Icon size="100" src={Icons.Check} /> : undefined}
                        >
                          <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
                            <Text as="span" size="T300" truncate>
                              {canvas.title}
                            </Text>
                            <Text as="span" size="T200" priority="300">
                              {date.format(canvas.updatedTs)}
                            </Text>
                          </Box>
                        </MenuItem>
                      );
                    })}
                  </Box>
                </Scroll>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
