import { IEventRelation, RelationType } from 'matrix-js-sdk';
import { IReplyDraft } from '../../state/room/roomInputDrafts';
import { Upload, UploadStatus } from '../../state/upload';
import { TUploadContent } from '../../utils/matrix';
import { getMessageRelation } from './composeMessageRelation';

export type RoomInputSendMode = 'room' | 'existing-thread' | 'auto-thread-upload-root';

export type RoomInputSendSessionState = {
  mode: RoomInputSendMode;
  orderedFiles: TUploadContent[];
  textPending: boolean;
  rootEventId?: string;
  blockedRoot: boolean;
  sentFiles: Set<TUploadContent>;
  failedFiles: Set<TUploadContent>;
};

export type RoomInputSendStep =
  | { kind: 'send-text' }
  | { kind: 'send-upload'; file: TUploadContent; mxc: string; isRoot: boolean }
  | { kind: 'wait' }
  | { kind: 'complete' };

const hasMatchingReplyRelation = (
  expected?: IEventRelation,
  current?: IEventRelation
): boolean => {
  if (!expected && !current) return true;
  if (!expected || !current) return false;

  return (
    expected.rel_type === current.rel_type &&
    expected.event_id === current.event_id &&
    expected.is_falling_back === current.is_falling_back &&
    expected['m.in_reply_to']?.event_id === current['m.in_reply_to']?.event_id
  );
};

export const hasMatchingReplyDraft = (
  expected?: IReplyDraft,
  current?: IReplyDraft
): boolean => {
  if (!expected && !current) return true;
  if (!expected || !current) return false;

  return (
    expected.userId === current.userId &&
    expected.eventId === current.eventId &&
    hasMatchingReplyRelation(expected.relation, current.relation)
  );
};

export const hasExplicitThreadContext = (
  threadId?: string,
  replyDraft?: IReplyDraft,
  threadingEnabled = true
): boolean =>
  threadingEnabled &&
  Boolean(
    threadId ||
      (replyDraft?.relation?.rel_type === RelationType.Thread &&
        typeof replyDraft.relation.event_id === 'string' &&
        replyDraft.relation.event_id.length > 0)
  );

export const getRoomInputSendMode = ({
  attachmentCount,
  hasText,
  threadId,
  replyDraft,
  threadingEnabled = true,
}: {
  attachmentCount: number;
  hasText: boolean;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled?: boolean;
}): RoomInputSendMode => {
  if (hasExplicitThreadContext(threadId, replyDraft, threadingEnabled)) {
    return 'existing-thread';
  }
  if (!threadingEnabled) return 'room';
  if (attachmentCount > 1 || (hasText && attachmentCount > 0)) {
    return 'auto-thread-upload-root';
  }
  return 'room';
};

export const createRoomInputSendSessionState = ({
  files,
  hasText,
  threadId,
  replyDraft,
  threadingEnabled = true,
}: {
  files: TUploadContent[];
  hasText: boolean;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled?: boolean;
}): RoomInputSendSessionState => ({
  mode: getRoomInputSendMode({
    attachmentCount: files.length,
    hasText,
    threadId,
    replyDraft,
    threadingEnabled,
  }),
  orderedFiles: files,
  textPending: hasText,
  blockedRoot: false,
  sentFiles: new Set(),
  failedFiles: new Set(),
});

const getPendingFiles = (
  session: RoomInputSendSessionState,
  activeFiles: TUploadContent[]
): TUploadContent[] => {
  const activeFileSet = new Set(activeFiles);

  return session.orderedFiles.filter(
    (file) => activeFileSet.has(file) && !session.sentFiles.has(file)
  );
};

const isUploadSuccess = (
  upload: Upload | undefined
): upload is Extract<Upload, { status: UploadStatus.Success }> =>
  upload?.status === UploadStatus.Success;

export const resolveRoomInputSendStep = (
  session: RoomInputSendSessionState,
  uploads: Upload[],
  activeFiles: TUploadContent[]
): RoomInputSendStep => {
  if (session.blockedRoot) {
    return { kind: 'wait' };
  }

  const pendingFiles = getPendingFiles(session, activeFiles);
  const uploadMap = new Map(uploads.map((upload) => [upload.file, upload]));

  if (
    session.mode === 'auto-thread-upload-root' &&
    !session.rootEventId &&
    pendingFiles.length > 0
  ) {
    const rootFile = pendingFiles[0];
    const upload = uploadMap.get(rootFile);

    if (isUploadSuccess(upload)) {
      return { kind: 'send-upload', file: rootFile, mxc: upload.mxc, isRoot: true };
    }

    return { kind: 'wait' };
  }

  for (const file of pendingFiles) {
    if (session.failedFiles.has(file)) {
      continue;
    }

    const upload = uploadMap.get(file);
    if (upload?.status === UploadStatus.Error) {
      // Intentional relaxed ordering: a non-root upload retry should not block already-ready
      // later attachments forever. Retried files still reuse the same resolved thread root.
      continue;
    }
    if (!isUploadSuccess(upload)) {
      return { kind: 'wait' };
    }

    return { kind: 'send-upload', file, mxc: upload.mxc, isRoot: false };
  }

  // Attachments go out first and the caption goes last: MindRoom coalesces a media batch into
  // one agent turn and closes it on the trailing text event. Files awaiting a manual retry do
  // not hold the caption back.
  if (session.textPending) {
    return { kind: 'send-text' };
  }

  if (pendingFiles.length === 0) {
    return { kind: 'complete' };
  }

  return { kind: 'wait' };
};

export const hasRoomInputSendFailures = (session: RoomInputSendSessionState): boolean =>
  session.blockedRoot || session.failedFiles.size > 0;

type RelationSession = Pick<RoomInputSendSessionState, 'mode' | 'rootEventId'> & {
  replyDraft?: IReplyDraft;
  threadId?: string;
  threadingEnabled?: boolean;
};

const allowThreadRelation = (session: RelationSession): boolean =>
  session.threadingEnabled ?? true;

export const getTextRelationForSendSession = (session: RelationSession) => {
  if (session.mode === 'existing-thread') {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      session.threadId,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (session.mode === 'auto-thread-upload-root' && session.rootEventId) {
    // The root upload already carried the reply metadata; the trailing caption just joins the
    // thread it opened.
    return getMessageRelation(undefined, undefined, session.rootEventId);
  }

  return getMessageRelation(session.replyDraft?.eventId, session.replyDraft?.relation, undefined, {
    allowThreadRelation: allowThreadRelation(session),
  });
};

export const getUploadRelationForSendSession = (
  session: RelationSession,
  isRoot: boolean
) => {
  if (session.mode === 'existing-thread') {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      session.threadId,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (session.mode === 'room') {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      undefined,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (session.mode === 'auto-thread-upload-root' && isRoot && !session.rootEventId) {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      undefined,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (!session.rootEventId) {
    return undefined;
  }

  return getMessageRelation(undefined, undefined, session.rootEventId);
};
