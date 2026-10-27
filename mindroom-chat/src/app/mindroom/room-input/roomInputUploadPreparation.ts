import { Room } from 'matrix-js-sdk';

import { TUploadItem, TUploadMetadata } from '../../state/room/roomInputDrafts';
import { encryptFile, toMatrixUploadError } from '../../utils/matrix';
import { safeFile } from '../../utils/mimeTypes';

export const createMindroomRoomUploadItems = async (
  files: File[],
  targetRoom: Room,
  getMetadata: (file: File, index: number) => TUploadMetadata = () => ({
    markedAsSpoiler: false,
  })
): Promise<TUploadItem[]> => {
  const safeFiles = files.map(safeFile);

  if (targetRoom.hasEncryptionStateEvent()) {
    const encryptedFiles = await Promise.allSettled(
      safeFiles.map(async (file, index) => ({
        encryptedFile: await encryptFile(file),
        index,
      }))
    );

    return encryptedFiles.reduce<TUploadItem[]>((items, result, settledIndex) => {
      if (result.status === 'rejected') {
        const file = safeFiles[settledIndex];
        if (!file) return items;

        items.push({
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: getMetadata(file, settledIndex),
          prepError: toMatrixUploadError(result.reason, 'create'),
        });
        return items;
      }

      const { encryptedFile, index } = result.value;
      items.push({
        ...encryptedFile,
        metadata: getMetadata(safeFiles[index], index),
      });
      return items;
    }, []);
  }

  return safeFiles.map((file, index) => ({
    file,
    originalFile: file,
    encInfo: undefined,
    metadata: getMetadata(file, index),
  }));
};
