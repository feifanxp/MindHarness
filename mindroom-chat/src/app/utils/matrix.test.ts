import { MatrixClient, MatrixError } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  addRoomIdToMDirect,
  getMatrixUploadErrorMessage,
  getMatrixUploadOriginalName,
  getMatrixUploadErrorStage,
  isTransientMatrixError,
  toMatrixUploadError,
  uploadContent,
} from './matrix';

const transientMessage = "Couldn't send — your connection dropped. Try again.";
const prepareUploadMessage = "Couldn't prepare file for upload.";

describe('matrix upload errors', () => {
  it('classifies transient upload errors narrowly', () => {
    expect(
      isTransientMatrixError(new DOMException('The operation was aborted.', 'AbortError'))
    ).toBe(true);
    expect(isTransientMatrixError(new MatrixError({ error: 'Unknown message' }))).toBe(true);
    expect(isTransientMatrixError(new MatrixError({ errcode: 'M_UNKNOWN', error: '' }))).toBe(true);
    expect(
      isTransientMatrixError(new MatrixError({ errcode: 'M_UNKNOWN', error: 'Upload failed' }))
    ).toBe(false);
    expect(isTransientMatrixError(new MatrixError({ error: 'Upload too large' }, 413))).toBe(false);
    expect(
      isTransientMatrixError(new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: '' }))
    ).toBe(false);
    expect(isTransientMatrixError(new MatrixError({ errcode: 'M_UNKNOWN', error: '' }, 413))).toBe(
      false
    );
    expect(isTransientMatrixError(new Error('Load failed'))).toBe(false);
  });

  it('preserves existing MatrixError instances while normalizing other upload errors', () => {
    const existing = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Nope' }, 403);
    const originalData = { ...existing.data };

    expect(toMatrixUploadError(existing, 'upload')).toBe(existing);
    expect(getMatrixUploadErrorStage(existing)).toBe('upload');
    expect(existing.data).toEqual(originalData);
    expect(existing.data).not.toHaveProperty('mindroom_upload_stage');
    expect(existing.data).not.toHaveProperty('mindroom_original_name');

    const normalized = toMatrixUploadError(
      new DOMException('The operation was aborted.', 'AbortError'),
      'upload'
    );
    expect(normalized).toBeInstanceOf(MatrixError);
    expect(normalized.errcode).toBe('M_UNKNOWN');
    expect(normalized.message).toContain('The operation was aborted.');
    expect(getMatrixUploadOriginalName(normalized)).toBe('AbortError');
    expect(normalized.data).not.toHaveProperty('mindroom_upload_stage');
    expect(normalized.data).not.toHaveProperty('mindroom_original_name');
  });

  it('preserves HTTP 413 status when normalizing non-JSON upload errors', () => {
    const httpTooLarge = Object.assign(new Error('Server returned 413 error'), {
      httpStatus: 413,
    });

    const normalized = toMatrixUploadError(httpTooLarge, 'upload');

    expect(normalized).toBeInstanceOf(MatrixError);
    expect(normalized.errcode).toBe('M_TOO_LARGE');
    expect(normalized.httpStatus).toBe(413);
    expect(normalized.message).toContain('Server returned 413 error');
  });

  it('returns friendly upload display messages', () => {
    expect(
      getMatrixUploadErrorMessage(new MatrixError({ errcode: 'M_UNKNOWN', error: '' }), 'upload')
    ).toBe(transientMessage);
    expect(
      getMatrixUploadErrorMessage(
        new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: 'Too many uploads' })
      )
    ).toBe('M_LIMIT_EXCEEDED: Too many uploads');
    expect(getMatrixUploadErrorMessage(undefined)).toBe("Couldn't send. Try again.");
  });

  it('returns precise avatar too-large upload messages', () => {
    const matrixTooLarge = new MatrixError({ errcode: 'M_UNKNOWN', error: '' }, 413);
    const rawHttpTooLarge = Object.assign(new Error('Server returned 413 error'), {
      httpStatus: 413,
    });

    expect(
      getMatrixUploadErrorMessage(matrixTooLarge, 'upload', {
        uploadKind: 'avatar',
        fileSize: 2_500_000,
        maxUploadSize: 1_000_000,
      })
    ).toBe('Avatar image is too large. Maximum upload size is 1.0 MB; selected file is 2.5 MB.');
    expect(
      getMatrixUploadErrorMessage(rawHttpTooLarge, 'upload', {
        uploadKind: 'avatar',
      })
    ).toBe('Avatar image is too large for this server. Choose a smaller image.');
    expect(getMatrixUploadErrorMessage(matrixTooLarge, 'upload')).not.toBe(transientMessage);
  });

  it('preserves generic upload error messages instead of treating them as transient', () => {
    const normalized = toMatrixUploadError(new Error('Local file read failed'), 'upload');

    expect(isTransientMatrixError(normalized)).toBe(false);
    expect(getMatrixUploadErrorMessage(normalized)).toBe('M_UNKNOWN: Local file read failed');
    expect(getMatrixUploadErrorMessage(normalized)).not.toBe(transientMessage);
  });

  it('preserves errcode-less MatrixError server rejections instead of treating them as transient', () => {
    const serverError = new MatrixError({ error: 'Upload failed server-side' }, 500);
    const forbidden = new MatrixError({ error: 'Uploads are disabled' }, 403);

    expect(isTransientMatrixError(serverError)).toBe(false);
    expect(getMatrixUploadErrorMessage(serverError, 'upload')).toBe('Upload failed server-side');
    expect(getMatrixUploadErrorMessage(serverError, 'upload')).not.toBe(transientMessage);
    expect(isTransientMatrixError(forbidden)).toBe(false);
    expect(getMatrixUploadErrorMessage(forbidden, 'send')).toBe('Uploads are disabled');
  });

  it('does not use transient network copy for create-stage normalized errors', () => {
    const normalized = toMatrixUploadError(new Error('create failed'), 'create');

    expect(getMatrixUploadErrorMessage(normalized)).toBe("Couldn't prepare file for upload.");
    expect(getMatrixUploadErrorMessage(normalized)).not.toBe(transientMessage);
  });

  it('attaches create-stage metadata to existing MatrixError instances', () => {
    const existing = new MatrixError({ errcode: 'M_UNKNOWN', error: '' });
    const originalData = { ...existing.data };
    const normalized = toMatrixUploadError(existing, 'create');

    expect(normalized).toBe(existing);
    expect(getMatrixUploadErrorStage(normalized)).toBe('create');
    expect(getMatrixUploadErrorMessage(normalized)).toBe("Couldn't prepare file for upload.");
    expect(existing.data).toEqual(originalData);
    expect(existing.data).not.toHaveProperty('mindroom_upload_stage');
    expect(existing.data).not.toHaveProperty('mindroom_original_name');
  });

  it('ignores server-shaped MindRoom upload metadata in MatrixError payloads', () => {
    const spoofedCreateStage = new MatrixError({
      errcode: 'M_UNKNOWN',
      error: 'Server rejection',
      mindroom_upload_stage: 'create',
      mindroom_original_name: 'AbortError',
    });
    const spoofedAbortName = new MatrixError({
      errcode: 'M_FORBIDDEN',
      error: '',
      mindroom_upload_stage: 'upload',
      mindroom_original_name: 'AbortError',
    });

    expect(getMatrixUploadErrorStage(spoofedCreateStage)).toBeUndefined();
    expect(getMatrixUploadOriginalName(spoofedCreateStage)).toBeUndefined();
    expect(getMatrixUploadErrorMessage(spoofedCreateStage)).toBe('M_UNKNOWN: Server rejection');
    expect(getMatrixUploadErrorMessage(spoofedCreateStage)).not.toBe(prepareUploadMessage);

    expect(getMatrixUploadOriginalName(spoofedAbortName)).toBeUndefined();
    expect(isTransientMatrixError(spoofedAbortName)).toBe(false);
    expect(getMatrixUploadErrorMessage(spoofedAbortName, 'upload')).not.toBe(transientMessage);
  });

  it('normalizes uploadContent aborts without copying the human message into errcode', async () => {
    const onError = vi.fn();
    const uploadAbort = new DOMException('The operation was aborted.', 'AbortError');
    const mx = {
      uploadContent: vi.fn(() => Promise.reject(uploadAbort)),
    };

    await uploadContent(mx as never, new Blob(['file']), {
      onSuccess: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({
      errcode: 'M_UNKNOWN',
      message: expect.stringContaining('The operation was aborted.'),
    });
  });
});

describe('m.direct updates', () => {
  it('keeps both rooms when two DM updates overlap', async () => {
    let direct: Record<string, string[]> = {};
    const mx = {
      getAccountData: () => ({ getContent: () => direct }),
      // Like the SDK, resolve only once the write is echoed back into the store.
      setAccountData: async (_type: string, content: Record<string, string[]>) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        direct = content;
      },
    } as unknown as MatrixClient;

    await Promise.all([
      addRoomIdToMDirect(mx, '!one:example.org', '@friend:example.org'),
      addRoomIdToMDirect(mx, '!two:example.org', '@friend:example.org'),
    ]);

    expect(direct).toEqual({ '@friend:example.org': ['!one:example.org', '!two:example.org'] });
  });

  it("does not hold one client's update behind another client's stuck write", async () => {
    const stuck = {
      getAccountData: () => undefined,
      // A stopped client never receives the sync echo, so its write never settles.
      setAccountData: () => new Promise(() => {}),
    } as unknown as MatrixClient;
    const setAccountData = vi.fn(async () => {});
    const other = { getAccountData: () => undefined, setAccountData } as unknown as MatrixClient;

    addRoomIdToMDirect(stuck, '!stuck:example.org', '@friend:example.org');
    await addRoomIdToMDirect(other, '!other:example.org', '@friend:example.org');

    expect(setAccountData).toHaveBeenCalledWith('m.direct', {
      '@friend:example.org': ['!other:example.org'],
    });
  });
});
