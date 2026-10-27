import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getFileMsgContent } from '../../features/room/msgContent';
import { uploadContent } from '../../utils/matrix';
import { createMindroomRoomUploadItems } from '../room-input/roomInputUploadPreparation';
import { withMindroomLongTextSidecarMetadata } from './longText';

const SIDECAR_FILENAME = 'message-content.json';
const SIDECAR_MIMETYPE = 'application/json';

/**
 * Prepares a message too large for one event the way MindRoom's backend sends long replies: the
 * whole content is uploaded as JSON (encrypted in an encrypted room), and the event to send is an
 * `m.file` preview that points at it. MindRoom and MindRoom Chat read the whole content back.
 */
export const uploadMindroomLongTextSidecar = async (
  mx: MatrixClient,
  room: Room,
  content: Record<string, unknown>,
  preview: Record<string, unknown> & { body: string }
): Promise<Record<string, unknown>> => {
  const json = JSON.stringify(content);
  const file = new File([json], SIDECAR_FILENAME, { type: SIDECAR_MIMETYPE });
  const [item] = await createMindroomRoomUploadItems([file], room);
  if (!item) throw new Error('The long message could not be prepared for upload.');
  if (item.prepError) throw item.prepError;
  const mxc = await new Promise<string>((resolve, reject) => {
    uploadContent(mx, item.file, {
      name: SIDECAR_FILENAME,
      fileType: SIDECAR_MIMETYPE,
      hideFilename: !!item.encInfo,
      onSuccess: resolve,
      onError: reject,
    });
  });
  return withMindroomLongTextSidecarMetadata(
    { ...getFileMsgContent(item, mxc), ...preview },
    new TextEncoder().encode(json).length
  );
};
