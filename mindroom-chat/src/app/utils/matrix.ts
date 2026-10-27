import {
  EncryptedAttachmentInfo,
  decryptAttachment,
  encryptAttachment,
} from 'browser-encrypt-attachment';
import {
  EventTimeline,
  MatrixClient,
  MatrixError,
  MatrixEvent,
  Room,
  RoomMember,
  UploadProgress,
  UploadResponse,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { IImageInfo, IThumbnailContent, IVideoInfo } from '../../types/matrix/common';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getStateEvent } from './room';
import { Membership, StateEvent } from '../../types/matrix/room';
import { bytesToSize } from './common';

export { mxcUrlToHttp } from './mediaUrl';

const DOMAIN_REGEX = /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/;

export const isServerName = (serverName: string): boolean => DOMAIN_REGEX.test(serverName);

const matchMxId = (id: string): RegExpMatchArray | null => id.match(/^([@$+#])([^\s:]+):(\S+)$/);

const validMxId = (id: string): boolean => !!matchMxId(id);

export const getMxIdServer = (userId: string): string | undefined => matchMxId(userId)?.[3];

export const getMxIdLocalPart = (userId: string): string | undefined => matchMxId(userId)?.[2];

export const isUserId = (id: string): boolean => validMxId(id) && id.startsWith('@');

export const isRoomId = (id: string): boolean => id.startsWith('!');

export const isRoomAlias = (id: string): boolean => validMxId(id) && id.startsWith('#');

export const getCanonicalAliasRoomId = (mx: MatrixClient, alias: string): string | undefined =>
  mx
    .getRooms()
    ?.find(
      (room) =>
        room.getCanonicalAlias() === alias &&
        getStateEvent(room, StateEvent.RoomTombstone) === undefined
    )?.roomId;

export const getCanonicalAliasOrRoomId = (mx: MatrixClient, roomId: string): string => {
  const room = mx.getRoom(roomId);
  if (!room) return roomId;
  if (getStateEvent(room, StateEvent.RoomTombstone) !== undefined) return roomId;
  const alias = room.getCanonicalAlias();
  if (alias && getCanonicalAliasRoomId(mx, alias) === roomId) {
    return alias;
  }
  return roomId;
};

export const getImageInfo = (img: HTMLImageElement, fileOrBlob: File | Blob): IImageInfo => {
  const info: IImageInfo = {};
  info.w = img.width;
  info.h = img.height;
  info.mimetype = fileOrBlob.type;
  info.size = fileOrBlob.size;
  return info;
};

export const getVideoInfo = (video: HTMLVideoElement, fileOrBlob: File | Blob): IVideoInfo => {
  const info: IVideoInfo = {};
  info.duration = Number.isNaN(video.duration) ? undefined : Math.floor(video.duration * 1000);
  info.w = video.videoWidth;
  info.h = video.videoHeight;
  info.mimetype = fileOrBlob.type;
  info.size = fileOrBlob.size;
  return info;
};

export const getThumbnailContent = (thumbnailInfo: {
  thumbnail: File | Blob;
  encInfo: EncryptedAttachmentInfo | undefined;
  mxc: string;
  width: number;
  height: number;
}): IThumbnailContent => {
  const { thumbnail, encInfo, mxc, width, height } = thumbnailInfo;

  const content: IThumbnailContent = {
    thumbnail_info: {
      mimetype: thumbnail.type,
      size: thumbnail.size,
      w: width,
      h: height,
    },
  };
  if (encInfo) {
    content.thumbnail_file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.thumbnail_url = mxc;
  }
  return content;
};

export const encryptFile = async (
  file: File | Blob
): Promise<{
  encInfo: EncryptedAttachmentInfo;
  file: File;
  originalFile: File | Blob;
}> => {
  const dataBuffer = await file.arrayBuffer();
  const encryptedAttachment = await encryptAttachment(dataBuffer);
  const encFile = new File([encryptedAttachment.data], file.name, {
    type: file.type,
  });
  return {
    encInfo: encryptedAttachment.info,
    file: encFile,
    originalFile: file,
  };
};

export const decryptFile = async (
  dataBuffer: ArrayBuffer,
  type: string,
  encInfo: EncryptedAttachmentInfo
): Promise<Blob> => {
  const dataArray = await decryptAttachment(dataBuffer, encInfo);
  const blob = new Blob([dataArray], { type });
  return blob;
};

export type TUploadContent = File | Blob;
export type MatrixUploadErrorStage = 'upload' | 'send' | 'create';
export type MatrixUploadKind = 'file' | 'avatar';
export type MatrixUploadErrorMessageOptions = {
  uploadKind?: MatrixUploadKind;
  fileSize?: number;
  maxUploadSize?: number;
};

const TRANSIENT_UPLOAD_ERROR_MESSAGE = "Couldn't send — your connection dropped. Try again.";
const FALLBACK_UPLOAD_ERROR_MESSAGE = "Couldn't send. Try again.";
const PREPARE_UPLOAD_ERROR_MESSAGE = "Couldn't prepare file for upload.";
const UNKNOWN_MESSAGE = 'Unknown message';

type MatrixUploadErrorMetadata = {
  stage?: MatrixUploadErrorStage;
  originalName?: string;
};

const matrixUploadErrorMetadata = new WeakMap<MatrixError, MatrixUploadErrorMetadata>();

const getErrorName = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string'
    ? err.name
    : undefined;

const getHttpStatus = (err: unknown): number | undefined => {
  if (typeof err !== 'object' || err === null || !('httpStatus' in err)) return undefined;

  const httpStatus = (err as { httpStatus?: unknown }).httpStatus;
  return typeof httpStatus === 'number' ? httpStatus : undefined;
};

const isKnownUploadSize = (size: number | undefined): size is number =>
  typeof size === 'number' && Number.isFinite(size) && size >= 0;

const getMatrixUploadOriginalNameValue = (err: MatrixError): string | undefined => {
  const originalName = matrixUploadErrorMetadata.get(err)?.originalName;
  return typeof originalName === 'string' && originalName.trim() !== '' ? originalName : undefined;
};

const setMatrixUploadErrorMetadata = (
  err: MatrixError,
  metadata: MatrixUploadErrorMetadata
): void => {
  matrixUploadErrorMetadata.set(err, {
    ...matrixUploadErrorMetadata.get(err),
    ...metadata,
  });
};

const stripMatrixErrorPrefix = (message: string): string =>
  message.replace(/^MatrixError:\s*/, '').trim();

const hasHttpStatus = (err: MatrixError): boolean =>
  typeof err.httpStatus === 'number' && err.httpStatus > 0;

const isMeaningfulErrorMessage = (message: string | undefined): boolean =>
  typeof message === 'string' && message.trim() !== '' && message.trim() !== UNKNOWN_MESSAGE;

const hasMeaningfulMatrixErrorDetails = (err: MatrixError): boolean => {
  if (hasHttpStatus(err)) return true;

  const dataError = err.data?.error;
  if (isMeaningfulErrorMessage(dataError)) return true;

  return isMeaningfulErrorMessage(stripMatrixErrorPrefix(err.message));
};

const nonEmptyMessage = (err: unknown): string => {
  if (err instanceof MatrixError) {
    const dataError = err.data?.error;
    if (typeof dataError === 'string' && dataError.trim() !== '') return dataError.trim();
  }
  if (err instanceof Error && err.message.trim() !== '') {
    return stripMatrixErrorPrefix(err.message);
  }
  if (typeof err === 'string' && err.trim() !== '') return err.trim();
  return UNKNOWN_MESSAGE;
};

export const isMatrixUploadTooLargeError = (err: unknown): boolean => {
  if (getHttpStatus(err) === 413) return true;

  return err instanceof MatrixError && err.errcode === 'M_TOO_LARGE';
};

export const isTransientMatrixError = (err: unknown): boolean => {
  if (getErrorName(err) === 'AbortError') return true;

  if (isMatrixUploadTooLargeError(err)) return false;

  if (err instanceof MatrixError) {
    if (getMatrixUploadOriginalNameValue(err) === 'AbortError') return true;
    if (err.errcode != null && err.errcode !== 'M_UNKNOWN') return false;

    return !hasMeaningfulMatrixErrorDetails(err);
  }

  return false;
};

export const toMatrixUploadError = (err: unknown, stage: MatrixUploadErrorStage): MatrixError => {
  if (err instanceof MatrixError) {
    if (!getMatrixUploadErrorStage(err)) {
      setMatrixUploadErrorMetadata(err, { stage });
    }
    return err;
  }

  const httpStatus = getHttpStatus(err);

  const matrixError = new MatrixError(
    {
      errcode: httpStatus === 413 ? 'M_TOO_LARGE' : 'M_UNKNOWN',
      error: nonEmptyMessage(err),
    },
    httpStatus
  );
  setMatrixUploadErrorMetadata(matrixError, {
    stage,
    originalName: getErrorName(err) ?? typeof err,
  });
  return matrixError;
};

export const getMatrixUploadErrorStage = (err: unknown): MatrixUploadErrorStage | undefined => {
  if (!(err instanceof MatrixError)) return undefined;

  const stage = matrixUploadErrorMetadata.get(err)?.stage;
  if (stage === 'upload' || stage === 'send' || stage === 'create') return stage;
  return undefined;
};

export const getMatrixUploadOriginalName = (err: unknown): string | undefined => {
  if (!(err instanceof MatrixError)) return undefined;

  return getMatrixUploadOriginalNameValue(err);
};

export const getMatrixUploadTooLargeMessage = (
  options: MatrixUploadErrorMessageOptions = {}
): string => {
  const { uploadKind = 'file', fileSize, maxUploadSize } = options;

  if (isKnownUploadSize(fileSize) && isKnownUploadSize(maxUploadSize)) {
    const subject = uploadKind === 'avatar' ? 'Avatar image' : 'File';

    return `${subject} is too large. Maximum upload size is ${bytesToSize(
      maxUploadSize
    )}; selected file is ${bytesToSize(fileSize)}.`;
  }

  if (uploadKind === 'avatar') {
    return 'Avatar image is too large for this server. Choose a smaller image.';
  }

  return 'File is too large for this server. Choose a smaller file.';
};

export const getMatrixUploadErrorMessage = (
  err: unknown,
  stage = getMatrixUploadErrorStage(err),
  options: MatrixUploadErrorMessageOptions = {}
): string => {
  if (isMatrixUploadTooLargeError(err)) {
    return getMatrixUploadTooLargeMessage(options);
  }

  if (stage === 'create') return PREPARE_UPLOAD_ERROR_MESSAGE;

  if (isTransientMatrixError(err)) {
    if (stage === 'upload' || stage === 'send') return TRANSIENT_UPLOAD_ERROR_MESSAGE;
  }

  if (err instanceof MatrixError && err.errcode) {
    return `${err.errcode}: ${nonEmptyMessage(err)}`;
  }

  if (err instanceof MatrixError && hasMeaningfulMatrixErrorDetails(err)) {
    return nonEmptyMessage(err);
  }

  return FALLBACK_UPLOAD_ERROR_MESSAGE;
};

export type ContentUploadOptions = {
  name?: string;
  fileType?: string;
  hideFilename?: boolean;
  onPromise?: (promise: Promise<UploadResponse>) => void;
  onProgress?: (progress: UploadProgress) => void;
  onSuccess: (mxc: string) => void;
  onError: (error: MatrixError) => void;
};

export const uploadContent = async (
  mx: MatrixClient,
  file: TUploadContent,
  options: ContentUploadOptions
) => {
  const { name, fileType, hideFilename, onProgress, onPromise, onSuccess, onError } = options;

  const uploadPromise = mx.uploadContent(file, {
    name,
    type: fileType,
    includeFilename: !hideFilename,
    progressHandler: onProgress,
  });
  onPromise?.(uploadPromise);
  try {
    const data = await uploadPromise;
    const mxc = data.content_uri;
    if (mxc) onSuccess(mxc);
    else onError(new MatrixError(data));
  } catch (e: any) {
    onError(toMatrixUploadError(e, 'upload'));
  }
};

export const matrixEventByRecency = (m1: MatrixEvent, m2: MatrixEvent) => m2.getTs() - m1.getTs();

export const factoryEventSentBy = (senderId: string) => (ev: MatrixEvent) =>
  ev.getSender() === senderId;

export const eventWithShortcode = (ev: MatrixEvent) =>
  typeof ev.getContent().shortcode === 'string';

export const getDMRoomFor = (mx: MatrixClient, userId: string): Room | undefined => {
  const dmLikeRooms = mx
    .getRooms()
    .filter(
      (room) =>
        room.getMyMembership() === Membership.Join &&
        room.hasEncryptionStateEvent() &&
        room.getMembers().length <= 2
    );

  return dmLikeRooms.find((room) => room.getMember(userId));
};

export const guessDmRoomUserId = (room: Room, myUserId: string): string => {
  const getOldestMember = (members: RoomMember[]): RoomMember | undefined => {
    let oldestMemberTs: number | undefined;
    let oldestMember: RoomMember | undefined;

    const pickOldestMember = (member: RoomMember) => {
      if (member.userId === myUserId) return;

      if (
        oldestMemberTs === undefined ||
        (member.events.member && member.events.member.getTs() < oldestMemberTs)
      ) {
        oldestMember = member;
        oldestMemberTs = member.events.member?.getTs();
      }
    };

    members.forEach(pickOldestMember);

    return oldestMember;
  };

  // Pick the joined user who's been here longest (and isn't us),
  const member = getOldestMember(room.getJoinedMembers());
  if (member) return member.userId;

  // if there are no joined members other than us, use the oldest member
  const member1 = getOldestMember(
    room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getMembers() ?? []
  );
  return member1?.userId ?? myUserId;
};

// m.direct updates read the stored content and write it back whole. Run each client's one at a
// time, so overlapping updates (several DM invites accepted at once) each start from the previous
// write; setAccountData resolves only after the write is echoed back into the store. The queue is
// per client: a stopped client's write never sees its echo and must not hold another account's.
const mDirectUpdates = new WeakMap<MatrixClient, Promise<void>>();
const queueMDirectUpdate = (mx: MatrixClient, update: () => Promise<void>): Promise<void> => {
  const run = (mDirectUpdates.get(mx) ?? Promise.resolve()).then(update);
  mDirectUpdates.set(
    mx,
    run.catch(() => undefined)
  );
  return run;
};

export const addRoomIdToMDirect = (
  mx: MatrixClient,
  roomId: string,
  userId: string
): Promise<void> =>
  queueMDirectUpdate(mx, async () => {
    const mDirectsEvent = mx.getAccountData(AccountDataEvent.Direct as any);
    let userIdToRoomIds: Record<string, string[]> = {};

    if (typeof mDirectsEvent !== 'undefined')
      userIdToRoomIds = structuredClone(mDirectsEvent.getContent());

    // remove it from the lists of any others users
    // (it can only be a DM room for one person)
    Object.keys(userIdToRoomIds).forEach((targetUserId) => {
      const roomIds = userIdToRoomIds[targetUserId];

      if (targetUserId !== userId) {
        const indexOfRoomId = roomIds.indexOf(roomId);
        if (indexOfRoomId > -1) {
          roomIds.splice(indexOfRoomId, 1);
        }
      }
    });

    const roomIds = userIdToRoomIds[userId] || [];
    if (roomIds.indexOf(roomId) === -1) {
      roomIds.push(roomId);
    }
    userIdToRoomIds[userId] = roomIds;

    await mx.setAccountData(AccountDataEvent.Direct as any, userIdToRoomIds as any);
  });

export const removeRoomIdFromMDirect = (mx: MatrixClient, roomId: string): Promise<void> =>
  queueMDirectUpdate(mx, async () => {
    const mDirectsEvent = mx.getAccountData(AccountDataEvent.Direct as any);
    let userIdToRoomIds: Record<string, string[]> = {};

    if (typeof mDirectsEvent !== 'undefined')
      userIdToRoomIds = structuredClone(mDirectsEvent.getContent());

    Object.keys(userIdToRoomIds).forEach((targetUserId) => {
      const roomIds = userIdToRoomIds[targetUserId];
      const indexOfRoomId = roomIds.indexOf(roomId);
      if (indexOfRoomId > -1) {
        roomIds.splice(indexOfRoomId, 1);
      }
    });

    await mx.setAccountData(AccountDataEvent.Direct as any, userIdToRoomIds as any);
  });

export const downloadMedia = async (src: string, init?: RequestInit): Promise<Blob> => {
  const res = await fetch(src, { ...init, method: 'GET' });
  if (!res.ok) throw new Error(`Unable to download media (${res.status})`);
  const blob = await res.blob();
  return blob;
};

export const downloadEncryptedMedia = async (
  src: string,
  decryptContent: (buf: ArrayBuffer) => Promise<Blob>,
  init?: RequestInit
): Promise<Blob> => {
  const encryptedContent = await downloadMedia(src, init);
  const decryptedContent = await decryptContent(await encryptedContent.arrayBuffer());

  return decryptedContent;
};

export const rateLimitedActions = async <T, R = void>(
  data: T[],
  callback: (item: T, index: number) => Promise<R>,
  maxRetryCount?: number
) => {
  let retryCount = 0;

  let actionInterval = 0;

  const sleepForMs = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const performAction = async (dataItem: T, index: number) => {
    const [err] = await to<R, MatrixError>(callback(dataItem, index));

    if (err?.httpStatus === 429) {
      if (retryCount === maxRetryCount) {
        return;
      }

      const waitMS = err.getRetryAfterMs() ?? 3000;
      actionInterval = waitMS * 1.5;
      await sleepForMs(waitMS);
      retryCount += 1;

      await performAction(dataItem, index);
    }
  };

  for (let i = 0; i < data.length; i += 1) {
    const dataItem = data[i];
    retryCount = 0;
    // eslint-disable-next-line no-await-in-loop
    await performAction(dataItem, i);
    if (actionInterval > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleepForMs(actionInterval);
    }
  }
};

export const knockSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6'];
  return !unsupportedVersion.includes(version);
};
export const restrictedSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7'];
  return !unsupportedVersion.includes(version);
};
export const knockRestrictedSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return !unsupportedVersion.includes(version);
};
export const creatorsSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  return !unsupportedVersion.includes(version);
};
