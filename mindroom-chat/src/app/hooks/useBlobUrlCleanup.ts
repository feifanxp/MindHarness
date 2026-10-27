import { useEffect } from 'react';
import { AsyncState, AsyncStatus } from './useAsyncCallback';

export const revokeBlobUrl = (url: string): void => {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};

/**
 * Revokes a blob URL stored in an AsyncState when the URL changes or the component unmounts.
 * Only revokes URLs that start with 'blob:' (skips HTTP URLs for non-encrypted media).
 */
export function useBlobUrlCleanup(state: AsyncState<string>): void {
  const blobUrl =
    state.status === AsyncStatus.Success && state.data.startsWith('blob:') ? state.data : undefined;

  useEffect(() => {
    return () => {
      if (blobUrl) {
        revokeBlobUrl(blobUrl);
      }
    };
  }, [blobUrl]);
}
