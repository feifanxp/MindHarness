import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { Descendant } from 'slate';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { IEventRelation, MatrixError, Room } from 'matrix-js-sdk';
import { createUploadAtomFamily } from '../upload';
import { TUploadContent } from '../../utils/matrix';
import { createListAtom } from '../list';
import {
  getSafeLocalStorage,
  getStorageKeysSafe,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';

export type TUploadMetadata = {
  markedAsSpoiler: boolean;
  mindroomPasteAttachment?: {
    id: string;
    chars: number;
    fileName: string;
  };
  voiceMessage?: {
    duration: number;
    waveform?: number[];
  };
};

export type TUploadItem = {
  /** Composer owning a paste attachment; ordinary uploads remain room-scoped. */
  composerDraftKey?: string;
  file: TUploadContent;
  originalFile: TUploadContent;
  metadata: TUploadMetadata;
  encInfo: EncryptedAttachmentInfo | undefined;
  prepError?: MatrixError;
};

export type TUploadListAtom = ReturnType<typeof createListAtom<TUploadItem>>;

export const roomIdToUploadItemsAtomFamily = atomFamily<string, TUploadListAtom>(createListAtom);

export const roomUploadAtomFamily = createUploadAtomFamily();

export const voiceAutoSendPendingAtom = atom(false);

export type PendingVoiceSendContext = {
  /**
   * Matrix user id of the session that captured this draft. Required so the
   * global atom cannot leak audio across an account switch — consumers must
   * ignore drafts whose ownerSessionId does not match the active session.
   */
  ownerSessionId: string;
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
};

/**
 * Marker stamped on the global pending-draft atom while a retry is in flight.
 * The token survives a keyed RoomProvider remount, so a freshly mounted
 * useVoiceRecorder can see "an existing retry is in progress" and refuse to
 * surface controls (Discard / Send) that would race the still-flying request.
 * The token also lets a stale resolution avoid clobbering a different
 * caller's atom write.
 */
export type PendingVoiceSendInFlight = {
  token: string;
  startedAt: number;
};

export type PendingVoiceSendDraft = {
  file: File;
  duration: number;
  waveform?: number[];
  errorMessage?: string;
  context: PendingVoiceSendContext;
  inFlight?: PendingVoiceSendInFlight;
};

export const pendingVoiceSendDraftAtom = atom<PendingVoiceSendDraft | undefined>(undefined);

export type RoomIdToMsgAction =
  | {
      type: 'PUT';
      roomId: string;
      msg: Descendant[];
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

export const getRoomInputDraftKey = (userId: string, roomId: string, threadId?: string): string =>
  JSON.stringify([userId, roomId, threadId ?? null]);

const COMPOSER_DRAFT_STORAGE_PREFIX = 'mindroom_composer_draft::';
const accountDraftVersions = new Map<string, number>();

/** Capture before asynchronous work so explicit account cleanup revokes its draft writes. */
export const captureRoomInputDraftGuard = (draftKey: string): (() => boolean) => {
  let userId = draftKey;
  try {
    const scope: unknown = JSON.parse(draftKey);
    if (Array.isArray(scope) && typeof scope[0] === 'string') [userId] = scope;
  } catch {
    /* Legacy unscoped callers use their key as the owner. */
  }
  const version = accountDraftVersions.get(userId) ?? 0;
  return () => (accountDraftVersions.get(userId) ?? 0) === version;
};

const isDraftNode = (node: unknown): boolean => {
  if (typeof node !== 'object' || node === null) return false;
  if ('text' in node) return typeof node.text === 'string';
  return (
    'type' in node &&
    typeof node.type === 'string' &&
    'children' in node &&
    Array.isArray(node.children) &&
    node.children.length > 0 &&
    node.children.every(isDraftNode)
  );
};

const readMsgDraft = (key: string): Descendant[] => {
  try {
    const value: unknown = JSON.parse(getStorageItemSafe(getSafeLocalStorage(), key) ?? '[]');
    return Array.isArray(value) && value.every((node) => isDraftNode(node) && 'children' in node)
      ? value
      : [];
  } catch {
    return [];
  }
};

const createMsgDraftAtom = (draftKey: string) => {
  const canWrite = captureRoomInputDraftGuard(draftKey);
  const storageKey = `${COMPOSER_DRAFT_STORAGE_PREFIX}${draftKey}`;
  const baseAtom = atom<Descendant[]>(readMsgDraft(storageKey));
  return atom(
    (get) => get(baseAtom),
    (_get, set, value: Descendant[]) => {
      if (!canWrite()) return;
      const serialized = JSON.stringify(value);
      set(baseAtom, JSON.parse(serialized) as Descendant[]);
      if (value.length === 0) removeStorageItemSafe(getSafeLocalStorage(), storageKey);
      else setStorageItemSafe(getSafeLocalStorage(), storageKey, serialized);
    }
  );
};
export type TMsgDraftAtom = ReturnType<typeof createMsgDraftAtom>;
export const roomIdToMsgDraftAtomFamily = atomFamily<string, TMsgDraftAtom>(createMsgDraftAtom);

export const clearRoomInputDrafts = (userId: string): void => {
  accountDraftVersions.set(userId, (accountDraftVersions.get(userId) ?? 0) + 1);
  const userPrefix = `[${JSON.stringify(userId)},`;
  const storage = getSafeLocalStorage();
  getStorageKeysSafe(storage)
    .filter((key) => key.startsWith(`${COMPOSER_DRAFT_STORAGE_PREFIX}${userPrefix}`))
    .forEach((key) => removeStorageItemSafe(storage, key));
  roomIdToMsgDraftAtomFamily.setShouldRemove((_createdAt, key) => key.startsWith(userPrefix));
  roomIdToMsgDraftAtomFamily.setShouldRemove(null);
};

export type IReplyDraft = {
  userId: string;
  eventId: string;
  body: string;
  formattedBody?: string | undefined;
  relation?: IEventRelation | undefined;
  /** Plain text, such as a canvas's title, that the reply bar shows without a Markdown preview, naming members as the quote does. */
  previewText?: string;
};
const createReplyDraftAtom = () => atom<IReplyDraft | undefined>(undefined);
export type TReplyDraftAtom = ReturnType<typeof createReplyDraftAtom>;
export const roomIdToReplyDraftAtomFamily = atomFamily<string, TReplyDraftAtom>(() =>
  createReplyDraftAtom()
);
