import { atom, useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { useCallback } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getScreenSize, ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

const mobileMembersOpenAtomFamily = atomFamily((_userId: string) => atom(false));

export function useMembersDrawer() {
  const userId = useMatrixClient().getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const desktopState = useSetting(settingsAtom, 'isPeopleDrawer');
  const mobileState = useAtom(mobileMembersOpenAtomFamily(userId));
  const setOpen = useCallback(
    (value: boolean | ((current: boolean) => boolean)) => {
      const target =
        getScreenSize(document.body.clientWidth) === ScreenSize.Mobile
          ? mobileState[1]
          : desktopState[1];
      target(value);
    },
    [desktopState, mobileState]
  );

  // Opening an overlay on a phone is independent of the saved split-layout preference.
  return [mobile ? mobileState[0] : desktopState[0], setOpen] as const;
}
