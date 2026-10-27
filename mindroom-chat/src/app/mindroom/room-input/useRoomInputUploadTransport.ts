import { useCallback } from 'react';
import { createStore } from 'jotai';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';

import {
  TUploadItem,
  TUploadMetadata,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
} from '../../features/room/msgContent';
import { encryptFile, toMatrixUploadError, uploadContent } from '../../utils/matrix';
import { safeFile } from '../../utils/mimeTypes';
import { withMindroomPasteAttachmentMetadata } from '../messages/pasteAttachmentMarker';
import { discardFailedLocalEcho } from '../messages/pendingLocalEcho';
import { getRoomMessageSentNotificationEventId } from '../threads/roomMessageSent';
import {
  getMindroomRoomInputVoiceUploadRelation,
  type MindroomVoiceSendContext,
} from './RoomInputMindroomExtensions';
import { createMindroomRoomUploadItems } from './roomInputUploadPreparation';

export const useRoomInputUploadTransport = (
  mx: MatrixClient,
  store: ReturnType<typeof createStore>,
  room: Room
) => {
  const createUploadItems = useCallback(
    async (
      files: File[],
      getMetadata: (file: File, index: number) => TUploadMetadata = () => ({
        markedAsSpoiler: false,
      }),
      targetRoom = room
    ): Promise<TUploadItem[]> => {
      return createMindroomRoomUploadItems(files, targetRoom, getMetadata);
    },
    [room]
  );

  const createVoiceUploadItems = useCallback(
    async (
      file: File,
      duration: number,
      waveform?: number[],
      targetRoom = room
    ): Promise<TUploadItem[]> => {
      const safeVoiceFile = safeFile(file);
      const metadata: TUploadMetadata = {
        markedAsSpoiler: false,
        voiceMessage: {
          duration,
          ...(waveform ? { waveform } : {}),
        },
      };

      if (targetRoom.hasEncryptionStateEvent()) {
        const encryptedFile = await encryptFile(safeVoiceFile);

        return [
          {
            ...encryptedFile,
            metadata,
          },
        ];
      }

      return [
        {
          file: safeVoiceFile,
          originalFile: safeVoiceFile,
          encInfo: undefined,
          metadata,
        },
      ];
    },
    [room]
  );

  const buildUploadMessageContent = useCallback(
    async (fileItem: TUploadItem, mxc: string, signalBridgedRoom: boolean) => {
      if (fileItem.file.type.startsWith('image')) {
        return getImageMsgContent(mx, fileItem, mxc);
      }
      if (fileItem.file.type.startsWith('video')) {
        return getVideoMsgContent(mx, fileItem, mxc);
      }
      if (fileItem.file.type.startsWith('audio')) {
        return getAudioMsgContent(fileItem, mxc, {
          voiceMessageMimeTypeOverride: signalBridgedRoom ? 'audio/aac' : undefined,
        });
      }
      return withMindroomPasteAttachmentMetadata(
        getFileMsgContent(fileItem, mxc),
        fileItem.metadata.mindroomPasteAttachment
      );
    },
    [mx]
  );

  const uploadItem = useCallback(
    async (fileItem: TUploadItem): Promise<string> => {
      const uploadAtom = roomUploadAtomFamily(fileItem.file);
      const upload = store.get(uploadAtom);
      if (upload.status === UploadStatus.Success) return upload.mxc;
      if (upload.status === UploadStatus.Error) throw upload.error;
      if (upload.status === UploadStatus.Loading) {
        try {
          const response = await upload.promise;
          if (!response.content_uri) {
            throw new Error('Upload completed without a content URI.');
          }
          store.set(uploadAtom, { mxc: response.content_uri });
          return response.content_uri;
        } catch (err) {
          const error = toMatrixUploadError(err, 'upload');
          store.set(uploadAtom, { error });
          throw error;
        }
      }

      return new Promise((resolve, reject) => {
        void uploadContent(mx, fileItem.file, {
          hideFilename: !!fileItem.encInfo,
          onPromise: (promise) => store.set(uploadAtom, { promise }),
          onProgress: (progress) => store.set(uploadAtom, { progress }),
          onSuccess: (mxc) => {
            store.set(uploadAtom, { mxc });
            resolve(mxc);
          },
          onError: (error) => {
            store.set(uploadAtom, { error });
            reject(error);
          },
        }).catch(reject);
      });
    },
    [mx, store]
  );

  const uploadItemWhileStaged = useCallback(
    async (ownerRoomId: string, fileItem: TUploadItem): Promise<TUploadItem | undefined> => {
      const uploadItemsAtom = roomIdToUploadItemsAtomFamily(ownerRoomId);
      if (!store.get(uploadItemsAtom).some((item) => item.file === fileItem.file)) {
        return undefined;
      }
      let unsubscribe: () => void = () => undefined;
      const removed = new Promise<undefined>((resolve) => {
        const resolveIfRemoved = () => {
          if (!store.get(uploadItemsAtom).some((item) => item.file === fileItem.file)) {
            resolve(undefined);
          }
        };
        unsubscribe = store.sub(uploadItemsAtom, resolveIfRemoved);
        resolveIfRemoved();
      });

      try {
        return await Promise.race([uploadItem(fileItem).then(() => fileItem), removed]);
      } finally {
        unsubscribe();
      }
    },
    [store, uploadItem]
  );

  const sendVoiceItem = useCallback(
    async (context: MindroomVoiceSendContext, fileItem: TUploadItem, mxc: string) => {
      const content = await buildUploadMessageContent(fileItem, mxc, context.signalBridgedRoom);
      const relation = getMindroomRoomInputVoiceUploadRelation(context, fileItem.file);
      const contentWithRelation: IContent = relation
        ? {
            ...content,
            'm.relates_to': relation,
          }
        : content;

      const txnId = mx.makeTxnId();
      const response = await mx
        .sendMessage(context.roomId, contentWithRelation as any, txnId)
        .catch((error: unknown) => {
          // The recorder keeps the recording to send again; drop the unsent echo.
          discardFailedLocalEcho(mx, context.room.getEventForTxnId(txnId));
          throw error;
        });
      return getRoomMessageSentNotificationEventId({
        eventId: response.event_id,
        relation,
        replyDraft: context.replyDraft,
        threadId: context.threadId,
      });
    },
    [mx, buildUploadMessageContent]
  );

  return {
    createUploadItems,
    createVoiceUploadItems,
    buildUploadMessageContent,
    uploadItem,
    uploadItemWhileStaged,
    sendVoiceItem,
  };
};
