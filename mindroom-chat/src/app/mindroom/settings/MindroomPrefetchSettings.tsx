import React, { MouseEventHandler, useState } from 'react';
import { Box, Button, Icon, Icons, PopOut, RectCords, Text, config } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useSetting } from '../../state/hooks/settings';
import { stopPropagation } from '../../utils/keyboard';
import type { PrefetchScope } from '../engine/prefetchPolicy';
import { mindroomSettingsAtom } from './mindroomSettings';

// CINNY-207 P6.1 / D4: user-facing prefetch settings.
//
// Two tiles under the "Messages" group in General settings:
//   1. "Prefetch scope" — which rooms the background scheduler keeps
//      ready (my-server / all-rooms / current-room-only).
//   2. "Current room history depth" — the target event count for the
//      band-4 deep-history sweep (clamped to
//      [ROOM_TAIL_PREFETCH_DEPTH, CURRENT_ROOM_DEEP_HISTORY_TARGET]).
//
// The scope selector mirrors `SelectMessageLayout` in
// features/settings/general/General.tsx (~762-820): folds PopOut +
// FocusTrap + Menu. The depth input follows the same shape the
// pre-D4 preload-limit input used: Escape resets, Enter/blur commits
// via `sanitizePrefetchDepth`, Success variant while dirty.

type MindroomPrefetchSettingsProps = {
  className?: string;
};

const PREFETCH_SCOPE_ITEMS = [
  { scope: 'all-rooms', labelKey: 'options.prefetchScope.allRooms' },
  { scope: 'current-room-only', labelKey: 'options.prefetchScope.currentRoomOnly' },
] as const satisfies ReadonlyArray<{ scope: PrefetchScope; labelKey: string }>;

export function MindroomPrefetchSettings({ className }: MindroomPrefetchSettingsProps) {
  const { t } = useTranslation();

  return (
    <>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title={t('settings.general.messages.prefetchScope')}
          description={t('settings.general.messages.prefetchScopeDescription')}
          after={<SelectPrefetchScope />}
        />
      </SequenceCard>
    </>
  );
}

export function SelectPrefetchScope() {
  const { t } = useTranslation();
  const [menuCords, setMenuCords] = useState<RectCords>();
  const [prefetchScope, setPrefetchScope] = useSetting(mindroomSettingsAtom, 'prefetchScope');

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (scope: PrefetchScope) => {
    setPrefetchScope(scope);
    setMenuCords(undefined);
  };

  const currentItem = PREFETCH_SCOPE_ITEMS.find((item) => item.scope === prefetchScope);
  const currentLabel = currentItem ? t(currentItem.labelKey) : prefetchScope;

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">{currentLabel}</Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {PREFETCH_SCOPE_ITEMS.map((item) => (
                  <MenuItem
                    key={item.scope}
                    size="300"
                    variant={prefetchScope === item.scope ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(item.scope)}
                  >
                    <Text size="T300">{t(item.labelKey)}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
