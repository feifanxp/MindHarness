import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useLocation, useMatch } from 'react-router-dom';
import { useNavToActivePathAtom } from '../state/hooks/navToActivePath';
import { ScreenSize, useScreenSizeContext } from './useScreenSize';

export const useNavToActivePathMapper = (
  navId: string | undefined,
  preserveMobileContent = false
) => {
  const location = useLocation();
  const setNavToActivePath = useSetAtom(useNavToActivePathAtom());
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const sectionRoot = !!useMatch({ path: '/:section/', end: true });

  useEffect(() => {
    // Opening a single-pane list must not replace the content it can return to.
    if (!navId || (preserveMobileContent && mobile && sectionRoot)) return;
    const { pathname, search, hash } = location;
    setNavToActivePath({
      type: 'PUT',
      navId,
      path: { pathname, search, hash },
    });
  }, [location, setNavToActivePath, navId, mobile, sectionRoot, preserveMobileContent]);
};
