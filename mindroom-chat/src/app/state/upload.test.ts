import React from 'react';
import { Provider, createStore } from 'jotai';
import { MatrixError } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createUploadAtom, UploadStatus, useBindUploadAtom } from './upload';

describe('useBindUploadAtom', () => {
  it('blocks guarded upload starts without calling Matrix uploadContent', async () => {
    const file = new File(['plain text'], 'secret.txt', { type: 'text/plain' });
    const uploadAtom = createUploadAtom(file);
    const store = createStore();
    const mx = {
      uploadContent: vi.fn(),
    };
    const blockUploadError = new MatrixError({ errcode: 'M_UNKNOWN', error: 'prep failed' });
    let startUpload: (() => Promise<void>) | undefined;

    const UploadBinder = () => {
      startUpload = useBindUploadAtom(mx as never, uploadAtom, {
        hideFilename: true,
        blockUploadError,
      }).startUpload;
      return null;
    };

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(UploadBinder)));
    });

    await act(async () => {
      await startUpload?.();
    });

    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(store.get(uploadAtom)).toEqual({
      file,
      status: UploadStatus.Error,
      error: blockUploadError,
    });
  });
});
