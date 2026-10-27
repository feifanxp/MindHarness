import { useEffect } from 'react';

type ResumeReason = 'focus' | 'online' | 'pageshow' | 'visibility';

export const usePageResume = (onResume: (reason: ResumeReason) => void) => {
  useEffect(() => {
    if (
      typeof window.addEventListener !== 'function' ||
      typeof window.removeEventListener !== 'function' ||
      typeof document.addEventListener !== 'function' ||
      typeof document.removeEventListener !== 'function'
    ) {
      return undefined;
    }

    let lastVisibilityState = document.visibilityState;

    const handleFocus = () => {
      onResume('focus');
    };

    const handleOnline = () => {
      onResume('online');
    };

    const handlePageShow = () => {
      onResume('pageshow');
    };

    const handleVisibilityChange = () => {
      const nextVisibilityState = document.visibilityState;
      if (nextVisibilityState === 'visible' && lastVisibilityState !== 'visible') {
        onResume('visibility');
      }
      lastVisibilityState = nextVisibilityState;
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [onResume]);
};
