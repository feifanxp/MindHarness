import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { Descendant, Editor } from 'slate';
import {
  resetEditor,
  resetEditorHistory,
  restoreEditorContent,
} from '../../components/editor/utils';
import { IReplyDraft, TUploadItem } from '../../state/room/roomInputDrafts';
import { Upload } from '../../state/upload';
import type { RoomInputAttachmentAccess } from '../room-input/roomInputAttachmentAccess';
import { TUploadContent } from '../../utils/matrix';
import { isSignalBridgeRoom } from '../bridges/bridgeDetection';
import {
  buildMindroomLongTextPreview,
  contentBytes,
  MAX_EVENT_CONTENT_BYTES,
} from '../messages/longText';
import { uploadMindroomLongTextSidecar } from '../messages/longTextSidecarUpload';
import { createMindroomPasteMarker } from '../messages/pasteAttachmentMarker';
import { discardFailedLocalEcho } from '../messages/pendingLocalEcho';
import {
  createRoomInputSendSessionState,
  getTextRelationForSendSession,
  getUploadRelationForSendSession,
  hasRoomInputSendFailures,
  resolveRoomInputSendStep,
  RoomInputSendSessionState,
} from './roomInputSendSession';
import { getRoomMessageSentNotificationEventId } from './roomMessageSent';

type SendSession = RoomInputSendSessionState & {
  room: Room;
  roomId: string;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  textContent?: IContent;
  composerFallback?: Descendant[];
  composerContext: Pick<RoomInputSendContext, 'roomId' | 'threadId'>;
  textTimelineOwned?: boolean;
  replyCleared: boolean;
  signalBridgedRoom: boolean;
  failFast: boolean;
  uploads?: Upload[];
  onUploadSent?: (file: TUploadContent) => void;
};

export type RoomInputSendContext = {
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
};

export type StartRoomInputSendSessionOptions = {
  textContent?: IContent;
  batch?: {
    fileItems: TUploadItem[];
    uploads: Upload[];
  };
  context?: RoomInputSendContext;
  completeWithinCall?: boolean;
  composerFallback?: Descendant[];
  composerContext?: Pick<RoomInputSendContext, 'roomId' | 'threadId'>;
  composerAlreadyReset?: boolean;
  onUploadSent?: (file: TUploadContent) => void;
};

export type RoomInputReplyDraftContext = Pick<RoomInputSendContext, 'roomId' | 'replyDraft'>;

type UseRoomInputSendSessionControllerOptions = {
  mx: MatrixClient;
  room: Room;
  roomId: string;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled?: boolean;
  clearReplyDraft: (context: RoomInputReplyDraftContext) => void;
  editor: Editor;
  sendTypingStatus: (typing: boolean) => void;
  attachments: RoomInputAttachmentAccess;
  mountedRef?: MutableRefObject<boolean>;
  buildUploadMessageContent: (
    fileItem: TUploadItem,
    mxc: string,
    signalBridgedRoom: boolean
  ) => Promise<IContent>;
  restoreComposerFallbackForRoom?: (
    roomId: string,
    fragment: Descendant[],
    threadId?: string
  ) => void;
  onRoomMessageSent?: (eventId: string) => boolean | void;
};

const getTextContentStrings = (content: IContent | undefined): string[] => {
  if (!content) return [];

  return [content.body, content.formatted_body].filter(
    (value): value is string => typeof value === 'string'
  );
};

export const hasFailedPasteMarkerInText = (
  textContent: IContent | undefined,
  fileItems: TUploadItem[]
): boolean => {
  const textValues = getTextContentStrings(textContent);
  if (textValues.length === 0) return false;

  return fileItems.some((fileItem) => {
    const pasteMetadata = fileItem.prepError
      ? fileItem.metadata.mindroomPasteAttachment
      : undefined;
    if (!pasteMetadata) return false;

    let marker: string;
    try {
      marker = createMindroomPasteMarker({
        id: pasteMetadata.id,
        chars: pasteMetadata.chars,
        fileName: pasteMetadata.fileName,
      });
    } catch {
      return false;
    }
    return textValues.some((text) => text.includes(marker));
  });
};

export const useRoomInputSendSessionController = ({
  mx,
  room,
  roomId,
  threadId,
  replyDraft,
  threadingEnabled = true,
  clearReplyDraft,
  editor,
  sendTypingStatus,
  attachments,
  mountedRef,
  buildUploadMessageContent,
  restoreComposerFallbackForRoom,
  onRoomMessageSent,
}: UseRoomInputSendSessionControllerOptions): {
  hasActiveSendSession: () => boolean;
  processSendSession: () => Promise<void>;
  startSendSession: (options?: StartRoomInputSendSessionOptions) => Promise<void>;
} => {
  const sendSessionRef = useRef<SendSession | undefined>();
  const processingSendSessionRef = useRef(false);
  const composerContextRef = useRef({ roomId, threadId });
  composerContextRef.current = { roomId, threadId };

  const clearReplyDraftForSession = useCallback(
    (session: SendSession) => {
      if (session.replyCleared) return;

      session.replyCleared = true;
      clearReplyDraft({
        roomId: session.roomId,
        replyDraft: session.replyDraft,
      });
    },
    [clearReplyDraft]
  );

  const sendSessionText = useCallback(
    async (session: SendSession) => {
      if (!session.textContent) return;

      const relation = getTextRelationForSendSession(session);
      const content: IContent = relation
        ? {
            ...session.textContent,
            'm.relates_to': relation,
          }
        : session.textContent;
      // Content too large for one event goes as a long-text sidecar, as MindRoom's long replies do.
      // A failed upload throws before anything is sent, so the text returns to the composer.
      const eventContent =
        contentBytes(content) <= MAX_EVENT_CONTENT_BYTES
          ? content
          : await uploadMindroomLongTextSidecar(
              mx,
              session.room,
              content,
              buildMindroomLongTextPreview(content)
            );
      const txnId = mx.makeTxnId();
      const sendPromise = mx.sendMessage(session.roomId, eventContent as any, txnId);
      const localEventId = session.room.getEventForTxnId(txnId)?.getId();
      let roomMessageSentNotified = false;

      const notifyRoomMessageSent = (eventId: string | undefined) => {
        if (!eventId || roomMessageSentNotified || !onRoomMessageSent) return;

        const sentEventIdToNotify = getRoomMessageSentNotificationEventId({
          eventId,
          relation,
          replyDraft: session.replyDraft,
          threadId: session.threadId,
        });
        if (!sentEventIdToNotify) return;

        roomMessageSentNotified = true;
        session.textTimelineOwned = onRoomMessageSent(sentEventIdToNotify) === true;
      };

      if (localEventId === `~${session.roomId}:${txnId}`) {
        notifyRoomMessageSent(localEventId);
      }

      const response = await sendPromise.catch((error: unknown) => {
        // Unless the timeline owns the failed message, its text goes back into the
        // composer; drop the unsent echo so the message cannot be sent twice.
        if (!session.textTimelineOwned) {
          discardFailedLocalEcho(mx, session.room.getEventForTxnId(txnId));
        }
        throw error;
      });
      notifyRoomMessageSent(response.event_id);

      session.textPending = false;
      clearReplyDraftForSession(session);
    },
    [mx, clearReplyDraftForSession, onRoomMessageSent]
  );

  const sendSessionUpload = useCallback(
    async (session: SendSession, file: TUploadContent, mxc: string, isRoot: boolean) => {
      const { staged, enrolled } = attachments.snapshot(session.roomId);
      const fileItem =
        staged.find((item) => item.file === file) ?? enrolled.find((item) => item.file === file);
      if (!fileItem) {
        throw new Error('Missing upload item for send session.');
      }

      const content = await buildUploadMessageContent(fileItem, mxc, session.signalBridgedRoom);
      const relation = getUploadRelationForSendSession(session, isRoot);
      const contentWithRelation: IContent = relation
        ? {
            ...content,
            'm.relates_to': relation,
          }
        : content;
      const txnId = mx.makeTxnId();
      const response = await mx
        .sendMessage(session.roomId, contentWithRelation as any, txnId)
        .catch((error: unknown) => {
          // The composer keeps the attachment to send again; drop the unsent echo.
          discardFailedLocalEcho(mx, session.room.getEventForTxnId(txnId));
          throw error;
        });
      const sentEventIdToNotify = getRoomMessageSentNotificationEventId({
        eventId: response.event_id,
        relation,
        replyDraft: session.replyDraft,
        threadId: session.threadId,
      });

      session.sentFiles.add(file);
      session.failedFiles.delete(file);
      if (session.mode === 'auto-thread-upload-root' && isRoot) {
        session.rootEventId = response.event_id;
      }
      session.onUploadSent?.(file);
      clearReplyDraftForSession(session);
      attachments.remove(session.roomId, [file]);
      if (sentEventIdToNotify) {
        onRoomMessageSent?.(sentEventIdToNotify);
      }
    },
    [mx, attachments, buildUploadMessageContent, clearReplyDraftForSession, onRoomMessageSent]
  );

  const restoreComposerFallback = useCallback(
    (session: SendSession) => {
      // A failed caption goes back into the composer instead of parking in the session: by the
      // time the caption sends, the uploads have left the board, so the board's Send-again
      // affordance that resumes a blocked session no longer exists.
      session.textPending = false;
      const fragment = session.composerFallback;
      session.composerFallback = undefined;
      const sameComposer =
        composerContextRef.current.roomId === session.composerContext.roomId &&
        composerContextRef.current.threadId === session.composerContext.threadId;
      if (fragment && (mountedRef?.current ?? true) && sameComposer) {
        restoreEditorContent(editor, fragment);
      } else if (fragment) {
        restoreComposerFallbackForRoom?.(
          session.composerContext.roomId,
          fragment,
          session.composerContext.threadId
        );
      }
    },
    [editor, mountedRef, restoreComposerFallbackForRoom]
  );

  const clearSendSession = useCallback(() => {
    sendSessionRef.current = undefined;
    attachments.clearEnrollment();
  }, [attachments]);

  const processSendSession = useCallback(async () => {
    if (processingSendSessionRef.current) return;

    processingSendSessionRef.current = true;
    try {
      while (sendSessionRef.current) {
        const session = sendSessionRef.current;

        const { staged, enrolled, uploads } = attachments.snapshot(session.roomId);
        const step = resolveRoomInputSendStep(
          session,
          session.uploads ?? uploads,
          Array.from(
            new Set([
              ...staged.map((fileItem) => fileItem.file),
              ...enrolled.map((fileItem) => fileItem.file),
            ])
          )
        );

        if (step.kind === 'wait') {
          return;
        }
        if (step.kind === 'complete') {
          clearSendSession();
          return;
        }

        if (step.kind === 'send-text') {
          try {
            await sendSessionText(session);
          } catch (error) {
            if (session.textTimelineOwned) {
              session.textPending = false;
              session.composerFallback = undefined;
            } else {
              restoreComposerFallback(session);
            }
            if (session.failFast) {
              throw error;
            }
          }
          continue;
        }

        try {
          await sendSessionUpload(session, step.file, step.mxc, step.isRoot);
        } catch (error) {
          if (session.failFast) {
            throw error;
          }
          if (step.isRoot) {
            session.blockedRoot = true;
            return;
          }
          session.failedFiles.add(step.file);
        }
      }
    } finally {
      processingSendSessionRef.current = false;
    }
  }, [attachments, sendSessionText, sendSessionUpload, restoreComposerFallback, clearSendSession]);

  const startSendSession = useCallback(
    async ({
      textContent,
      batch,
      context,
      completeWithinCall = false,
      composerFallback,
      composerContext,
      composerAlreadyReset = false,
      onUploadSent,
    }: StartRoomInputSendSessionOptions = {}) => {
      const existingSession = sendSessionRef.current;
      if (existingSession) {
        if (completeWithinCall) {
          throw new Error(
            'Cannot start a lifecycle-complete send while another session is active.'
          );
        }
        if (!hasRoomInputSendFailures(existingSession)) {
          // Repeated sends while uploads are still resolving should not create duplicate events.
          return;
        }

        existingSession.blockedRoot = false;
        existingSession.failedFiles.clear();
        await processSendSession();
        return;
      }

      const { staged } = attachments.snapshot(context?.roomId);
      const sendItems = (batch?.fileItems ?? staged).filter((fileItem) => !fileItem.prepError);
      const sendFiles = sendItems.map((item) => item.file);
      if (sendFiles.length === 0 && !textContent) return;
      if (hasFailedPasteMarkerInText(textContent, staged)) return;
      attachments.enroll(sendItems);

      const sessionRoomId = context ? context.roomId : roomId;
      const sessionRoom = context ? context.room : room;
      const sessionThreadId = context ? context.threadId : threadId;
      const sessionReplyDraft = context ? context.replyDraft : replyDraft;
      const sessionThreadingEnabled = context ? context.threadingEnabled : threadingEnabled;
      const signalBridgedRoom = context ? context.signalBridgedRoom : isSignalBridgeRoom(room);

      sendSessionRef.current = {
        composerContext: composerContext ?? { roomId, threadId },
        room: sessionRoom,
        roomId: sessionRoomId,
        threadId: sessionThreadId,
        replyDraft: sessionReplyDraft,
        threadingEnabled: sessionThreadingEnabled,
        textContent,
        replyCleared: false,
        signalBridgedRoom,
        failFast: completeWithinCall,
        uploads: batch?.uploads,
        onUploadSent,
        ...createRoomInputSendSessionState({
          files: sendFiles,
          hasText: Boolean(textContent),
          threadId: sessionThreadId,
          replyDraft: sessionReplyDraft,
          threadingEnabled: sessionThreadingEnabled,
        }),
      };
      if (textContent) {
        // The caption sends last (after the uploads), so free the composer as soon as the
        // session has snapshotted the text instead of when the text event goes out. Keep a
        // clone of the composer content so a failed caption can be restored (slate mutates
        // editor.children in place).
        sendSessionRef.current.composerFallback =
          composerFallback ?? structuredClone(editor.children);
        if (!composerAlreadyReset) {
          resetEditor(editor);
          resetEditorHistory(editor);
          sendTypingStatus(false);
        }
      }
      try {
        await processSendSession();
      } catch (error) {
        if (completeWithinCall) {
          const failedSession = sendSessionRef.current;
          if (failedSession?.textPending) {
            restoreComposerFallback(failedSession);
          }
          clearSendSession();
        }
        throw error;
      }
      if (completeWithinCall && sendSessionRef.current) {
        clearSendSession();
        throw new Error('Lifecycle-complete send did not finish within the initiating call.');
      }
    },
    [
      roomId,
      threadId,
      replyDraft,
      threadingEnabled,
      room,
      editor,
      sendTypingStatus,
      attachments,
      processSendSession,
      restoreComposerFallback,
      clearSendSession,
    ]
  );

  useEffect(() => {
    let disposed = false;
    let queued = false;
    const wake = () => {
      if (queued) return;
      queued = true;
      // Attachment updates can render synchronously inside enrollment/removal. Defer
      // processing until the initiating operation finishes updating the send session.
      queueMicrotask(() => {
        queued = false;
        if (!disposed) void processSendSession();
      });
    };
    const unsubscribe = attachments.subscribe(wake);
    wake();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [attachments, processSendSession]);

  const hasActiveSendSession = useCallback(() => sendSessionRef.current !== undefined, []);

  return {
    hasActiveSendSession,
    processSendSession,
    startSendSession,
  };
};
