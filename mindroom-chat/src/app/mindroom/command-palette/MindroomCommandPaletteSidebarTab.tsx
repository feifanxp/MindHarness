import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Icon, Icons, Text } from 'folds';
import { useAtom } from 'jotai';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import { commandPaletteOpenAtom } from './commandPaletteState';
import {
  getCommandPaletteAriaKeyShortcuts,
  getCommandPaletteShortcutLabel,
} from './commandPaletteShortcut';

export function MindroomCommandPaletteSidebarTab() {
  const { t } = useTranslation();
  const [opened, setOpen] = useAtom(commandPaletteOpenAtom);
  const simpleMode = useSimpleMode();
  if (simpleMode) return null;

  const open = () => setOpen(true);

  return (
    <SidebarItem active={opened}>
      <SidebarItemTooltip
        tooltip={
          <Box as="span" alignItems="Center" gap="200">
            {t('commandPalette.open')}
            <Badge as="kbd" radii="300" size="500">
              <Text as="span" size="T200">
                {getCommandPaletteShortcutLabel()}
              </Text>
            </Badge>
          </Box>
        }
      >
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            onClick={open}
            aria-label={t('commandPalette.open')}
            aria-keyshortcuts={getCommandPaletteAriaKeyShortcuts()}
          >
            <Icon src={Icons.Search} filled={opened} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
