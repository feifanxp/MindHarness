import React, { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Text } from 'folds';
import { archivedRoomsAtom, isRoomVisible } from '../rooms/archivedRooms';
import { NavCategory, NavCategoryHeader } from '../../components/nav';
import { RoomNavCategoryButton } from '../../features/room-nav';
import { useCategoryHandler } from '../../hooks/useCategoryHandler';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../state/hooks/closedNavCategories';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { getAllParents } from '../../utils/room';
import { crossRoomThreadIndexAtom } from '../cross-room-threads/crossRoomThreadIndex';
import { buildSidebarThreadEntries } from './threadNavCategoryUtils';
import { ThreadNavItem } from './ThreadNavItem';
import { makeThreadSidebarPreferencesAtom } from './threadSidebarPreferences';
import * as css from './threadNav.css';

export const THREAD_NAV_CATEGORY_ID = makeNavCategoryId('mindroom', 'threads');

type ThreadNavCategoryProps = {
  spaceId?: string;
};

export function ThreadNavCategory({ spaceId }: ThreadNavCategoryProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const selectedRoomId = useSelectedRoom();
  const [searchParams] = useSearchParams();
  const selectedThreadId = searchParams.get('threadId');
  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);
  const archivedRooms = useAtomValue(archivedRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const preferencesAtom = useMemo(() => makeThreadSidebarPreferencesAtom(userId), [userId]);
  const [preferences, setPreferences] = useAtom(preferencesAtom);
  const entries = useMemo(() => {
    const scopedEntries = spaceId
      ? Array.from(indexSnapshot.entries.values()).filter(
          (entry) =>
            entry.roomId === spaceId || getAllParents(roomToParents, entry.roomId).has(spaceId)
        )
      : indexSnapshot.entries.values();

    return buildSidebarThreadEntries(
      Array.from(scopedEntries).filter((entry) => isRoomVisible(entry.roomId, archivedRooms)),
      preferences.pinnedThreadKeys,
      directRoomIds
    );
  }, [
    archivedRooms,
    directRoomIds,
    indexSnapshot.entries,
    preferences.pinnedThreadKeys,
    roomToParents,
    spaceId,
  ]);

  const closed = closedCategories.has(THREAD_NAV_CATEGORY_ID);
  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );

  return (
    <NavCategory data-testid="thread-nav-category">
      <NavCategoryHeader>
        <RoomNavCategoryButton
          closed={closed}
          data-category-id={THREAD_NAV_CATEGORY_ID}
          onClick={handleCategoryClick}
        >
          {t('threadNav.title')}
        </RoomNavCategoryButton>
      </NavCategoryHeader>
      {!closed && (
        <div data-testid="thread-nav-list">
          {!indexSnapshot.bootstrapped ? (
            <Text className={css.CategoryState} as="p" size="T200">
              {t('threadNav.loading')}
            </Text>
          ) : entries.length === 0 ? (
            <Text className={css.CategoryState} as="p" size="T200">
              {t('threadNav.empty')}
            </Text>
          ) : (
            entries.map((entry) => (
              <ThreadNavItem
                key={entry.key}
                entry={entry}
                pinned={preferences.pinnedThreadKeys.includes(entry.key)}
                selected={
                  selectedRoomId === entry.roomId && selectedThreadId === entry.threadRootId
                }
                onTogglePin={() => setPreferences({ type: 'TOGGLE_PIN', threadKey: entry.key })}
              />
            ))
          )}
        </div>
      )}
    </NavCategory>
  );
}
