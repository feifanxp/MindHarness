import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { IReplyDraft } from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import {
  createRoomInputSendSessionState,
  getTextRelationForSendSession,
  getUploadRelationForSendSession,
  resolveRoomInputSendStep,
} from './roomInputSendSession';

const createFile = (name: string, type = 'image/png') => new File(['x'], name, { type });

const successUpload = (file: File, suffix = file.name) => ({
  file,
  status: UploadStatus.Success as const,
  mxc: `mxc://mindroom/${suffix}`,
});

const loadingUpload = (file: File) => ({
  file,
  status: UploadStatus.Loading as const,
  progress: { loaded: 1, total: 2 },
  promise: Promise.resolve({ content_uri: 'mxc://mindroom/loading' }),
});

const errorUpload = (file: File) => ({
  file,
  status: UploadStatus.Error as const,
  error: new Error('upload failed'),
});

const plainReplyDraft = (eventId = '$reply'): IReplyDraft => ({
  userId: '@alice:example.org',
  eventId,
  body: 'reply body',
});

describe('roomInputSendSession', () => {
  it('sends attachments first and the caption last for text plus attachments', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
    });

    expect(session.mode).toBe('auto-thread-upload-root');

    expect(
      resolveRoomInputSendStep(
        session,
        [loadingUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'wait' });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({
      kind: 'send-upload',
      file: first,
      mxc: 'mxc://mindroom/first.png',
      isRoot: true,
    });

    session.sentFiles.add(first);
    session.rootEventId = '$root';

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });

    session.sentFiles.add(second);

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'send-text' });

    session.textPending = false;

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'complete' });

    expect(getTextRelationForSendSession(session)).toMatchObject({
      event_id: '$root',
      rel_type: RelationType.Thread,
    });
  });

  it('auto-threads a single attachment with a caption under the upload root', () => {
    const only = createFile('only.png');
    const session = createRoomInputSendSessionState({
      files: [only],
      hasText: true,
    });

    expect(session.mode).toBe('auto-thread-upload-root');
    expect(resolveRoomInputSendStep(session, [successUpload(only)], [only])).toEqual({
      kind: 'send-upload',
      file: only,
      mxc: 'mxc://mindroom/only.png',
      isRoot: true,
    });

    session.sentFiles.add(only);
    session.rootEventId = '$root';

    expect(resolveRoomInputSendStep(session, [successUpload(only)], [only])).toEqual({
      kind: 'send-text',
    });
  });

  it('uses the first attachment as the root and threads the rest for attachment-only sends', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: false,
    });

    expect(session.mode).toBe('auto-thread-upload-root');
    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: first,
      mxc: 'mxc://mindroom/first.png',
      isRoot: true,
    });

    session.sentFiles.add(first);
    session.rootEventId = '$root';

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });
  });

  it('keeps a single attachment as a room-level send', () => {
    const only = createFile('only.png');
    const session = createRoomInputSendSessionState({
      files: [only],
      hasText: false,
    });

    expect(session.mode).toBe('room');
    expect(resolveRoomInputSendStep(session, [successUpload(only)], [only])).toEqual({
      kind: 'send-upload',
      file: only,
      mxc: 'mxc://mindroom/only.png',
      isRoot: false,
    });
  });

  it('preserves explicit thread context without creating a new root event', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
      threadId: '$thread',
    });

    expect(session.mode).toBe('existing-thread');
    expect(getTextRelationForSendSession({ ...session, threadId: '$thread' })).toMatchObject({
      event_id: '$thread',
      rel_type: RelationType.Thread,
      is_falling_back: true,
    });

    expect(resolveRoomInputSendStep(session, [], [first, second])).toEqual({ kind: 'wait' });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({
      kind: 'send-upload',
      file: first,
      mxc: 'mxc://mindroom/first.png',
      isRoot: false,
    });

    session.sentFiles.add(first);
    session.sentFiles.add(second);

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'send-text' });
    expect(session.rootEventId).toBeUndefined();
  });

  it('keeps classic-mode sends at room level and suppresses thread reply relations', () => {
    const session = createRoomInputSendSessionState({
      files: [createFile('first.png'), createFile('second.png')],
      hasText: true,
      replyDraft: {
        ...plainReplyDraft(),
        relation: {
          rel_type: RelationType.Thread,
          event_id: '$thread',
        },
      },
      threadingEnabled: false,
    });

    expect(session.mode).toBe('room');
    expect(
      getTextRelationForSendSession({
        ...session,
        replyDraft: {
          ...plainReplyDraft(),
          relation: {
            rel_type: RelationType.Thread,
            event_id: '$thread',
          },
        },
        threadingEnabled: false,
      })
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });
  });

  it('keeps plain reply metadata on the root and threads later attachments under the new root', () => {
    const first = createFile('first.png');
    const captionedSession = createRoomInputSendSessionState({
      files: [first],
      hasText: true,
      replyDraft: plainReplyDraft(),
    });

    expect(
      getUploadRelationForSendSession({ ...captionedSession, replyDraft: plainReplyDraft() }, true)
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });

    captionedSession.rootEventId = '$new-root';

    expect(
      getTextRelationForSendSession({ ...captionedSession, replyDraft: plainReplyDraft() })
    ).toMatchObject({
      event_id: '$new-root',
      rel_type: RelationType.Thread,
    });

    const uploadSession = createRoomInputSendSessionState({
      files: [first, createFile('second.png')],
      hasText: false,
      replyDraft: plainReplyDraft(),
    });

    expect(
      getUploadRelationForSendSession(
        {
          ...uploadSession,
          replyDraft: plainReplyDraft(),
        },
        true
      )
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });

    uploadSession.rootEventId = '$new-root';

    expect(
      getUploadRelationForSendSession(
        {
          ...uploadSession,
          replyDraft: plainReplyDraft(),
        },
        false
      )
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$new-root',
      },
      event_id: '$new-root',
      rel_type: RelationType.Thread,
      is_falling_back: true,
    });
  });

  it('blocks later attachments when the root upload fails, then promotes the next file after removal', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: false,
    });

    expect(
      resolveRoomInputSendStep(
        session,
        [errorUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({ kind: 'wait' });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(second), successUpload(third)],
        [second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: true,
    });
  });

  it('skips failed non-root uploads without blocking later successful attachments and reuses the same root on retry', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: false,
    });

    session.sentFiles.add(first);
    session.rootEventId = '$root';

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), errorUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: third,
      mxc: 'mxc://mindroom/third.png',
      isRoot: false,
    });

    session.sentFiles.add(third);

    expect(
      getUploadRelationForSendSession(
        {
          ...session,
          replyDraft: plainReplyDraft(),
        },
        false
      )
    ).toMatchObject({
      event_id: '$root',
      rel_type: RelationType.Thread,
    });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });
  });

  it('sends the caption without waiting for a failed non-root upload awaiting manual retry', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
    });

    session.sentFiles.add(first);
    session.rootEventId = '$root';
    session.failedFiles.add(second);

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), errorUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'send-text' });

    session.textPending = false;

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), errorUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'wait' });
  });
});
