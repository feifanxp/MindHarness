import React, { MouseEventHandler, forwardRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Icon, Icons, PopOut, RectCords, config, toRem } from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Menu } from '../../../components/glass/GlassPrimitives';
import { useOrphanRooms } from '../../../state/hooks/roomList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { navigationRoomsAtom } from '../../../mindroom/rooms/archivedRooms';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { getHomePath, joinPathComponent } from '../../pathUtils';
import { useRoomsUnread } from '../../../state/hooks/unread';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../../components/sidebar';
import { useHomeSelected } from '../../../hooks/router/useHomeSelected';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { UnreadBadge } from '../../../components/unread-badge';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { useHomeRooms } from '../home/useHomeRooms';
import { stopPropagation } from '../../../utils/keyboard';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';

type HomeMenuProps = {
  requestClose: () => void;
};
const HomeMenu = forwardRef<HTMLDivElement, HomeMenuProps>(({ requestClose }, ref) => {
  const orphanRooms = useHomeRooms();

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MindroomMarkRoomsReadMenuItem roomIds={orphanRooms} onClose={requestClose} />
      </Box>
    </Menu>
  );
});

export function HomeTab({ onSelect }: { onSelect?: (selected: boolean) => boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());

  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const orphanRooms = useOrphanRooms(mx, navigationRoomsAtom, mDirects, roomToParents);
  const homeUnread = useRoomsUnread(orphanRooms, roomToUnreadAtom);
  const homeSelected = useHomeSelected();
  const screenSize = useScreenSizeContext();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleHomeClick = () => {
    if (onSelect?.(homeSelected)) return;
    const activePath = navToActivePath.get('home');
    if (activePath && (screenSize !== ScreenSize.Mobile || homeSelected)) {
      navigate(joinPathComponent(activePath));
      return;
    }

    navigate(getHomePath());
  };

  const handleContextMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    evt.preventDefault();
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <SidebarItem active={homeSelected}>
      <SidebarItemTooltip tooltip={t('nav.home')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            aria-label={t('nav.home')}
            ref={triggerRef}
            outlined
            onClick={handleHomeClick}
            onContextMenu={handleContextMenu}
          >
            <Icon src={Icons.Home} filled={homeSelected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {homeUnread && (
        <SidebarItemBadge hasCount={homeUnread.total > 0}>
          <UnreadBadge highlight={homeUnread.highlight > 0} count={homeUnread.total} />
        </SidebarItemBadge>
      )}
      {menuAnchor && (
        <PopOut
          anchor={menuAnchor}
          position="Right"
          align="Start"
          content={
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                returnFocusOnDeactivate: false,
                onDeactivate: () => setMenuAnchor(undefined),
                clickOutsideDeactivates: true,
                isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                escapeDeactivates: stopPropagation,
              }}
            >
              <HomeMenu requestClose={() => setMenuAnchor(undefined)} />
            </FocusTrap>
          }
        />
      )}
    </SidebarItem>
  );
}
