import React from 'react';
import { MatrixError } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadCardRenderer } from './UploadCardRenderer';
import { CompactUploadCardRenderer } from './CompactUploadCardRenderer';
import { TUploadContent, toMatrixUploadError } from '../../utils/matrix';

const uploadMock = vi.hoisted(() => ({
  upload: undefined as unknown,
  startUpload: vi.fn(),
  cancelUpload: vi.fn(),
  roomUploadAtomFamily: vi.fn(() => 'room-upload-atom'),
  mediaConfig: {} as Record<string, number>,
  useBindUploadAtom: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  const forwardTag = (tag: string) =>
    React.forwardRef<HTMLElement, Record<string, unknown>>(({ children, ...props }, ref) =>
      reactModule.createElement(tag, { ...props, ref }, children)
    );

  return {
    Badge: forwardTag('span'),
    Box: forwardTag('div'),
    Chip: forwardTag('button'),
    Icon: forwardTag('span'),
    IconButton: forwardTag('button'),
    Icons: {
      Check: 'Check',
      Cross: 'Cross',
      EyeBlind: 'EyeBlind',
      File: 'File',
      Photo: 'Photo',
      Play: 'Play',
      Vlc: 'Vlc',
      Warning: 'Warning',
    },
    ProgressBar: forwardTag('progress'),
    Text: forwardTag('span'),
    color: {
      Success: {
        Main: 'green',
      },
    },
    config: {
      radii: {
        R300: '8px',
      },
      space: {
        S100: '4px',
      },
    },
    percent: (min: number, max: number, value: number) => ((value - min) / (max - min)) * 100,
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('./UploadCard.css', () => ({
  UploadCard: () => 'upload-card',
  UploadCardError: 'upload-card-error',
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../hooks/useMediaConfig', () => ({
  useMediaConfig: () => uploadMock.mediaConfig,
}));

vi.mock('../../hooks/useObjectURL', () => ({
  useObjectURL: () => undefined,
}));

vi.mock('../../state/upload', () => ({
  UploadStatus: {
    Idle: 'idle',
    Loading: 'loading',
    Success: 'success',
    Error: 'error',
  },
  useBindUploadAtom: (...args: unknown[]) => {
    uploadMock.useBindUploadAtom(...args);
    return {
      upload: uploadMock.upload,
      startUpload: uploadMock.startUpload,
      cancelUpload: uploadMock.cancelUpload,
    };
  },
}));

vi.mock('../../state/room/roomInputDrafts', () => ({
  roomUploadAtomFamily: uploadMock.roomUploadAtomFamily,
}));

const friendlyTransientMessage = "Couldn't send — your connection dropped. Try again.";
const prepareUploadMessage = "Couldn't prepare file for upload.";

const createFile = (overrides: Partial<TUploadContent> = {}): TUploadContent =>
  ({
    name: 'image.png',
    size: 1024,
    type: 'image/png',
    ...overrides,
  } as TUploadContent);

const setUploadError = (
  file: TUploadContent,
  error = new MatrixError({ errcode: 'M_UNKNOWN', error: '' })
) => {
  uploadMock.upload = {
    file,
    status: 'error',
    error,
  };
};

const renderText = (node: React.ReactElement): string => {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(node);
  });
  return JSON.stringify(renderer?.toJSON());
};

describe('upload card renderers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mediaConfig = {};
  });

  it('renders friendly transient MatrixError text in the full upload card', () => {
    const file = createFile();
    setUploadError(file);

    const output = renderText(
      React.createElement(UploadCardRenderer, {
        fileItem: {
          file,
          originalFile: file,
          metadata: {
            markedAsSpoiler: false,
          },
          encInfo: undefined,
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );

    expect(output).toContain(friendlyTransientMessage);
    expect(output).not.toContain('M_UNKNOWN: Unknown message');
  });

  it('renders local prep errors without retrying an unsafe upload', () => {
    const file = createFile();
    uploadMock.upload = {
      file,
      status: 'idle',
    };

    const output = renderText(
      React.createElement(UploadCardRenderer, {
        fileItem: {
          file,
          originalFile: file,
          metadata: {
            markedAsSpoiler: false,
          },
          encInfo: undefined,
          prepError: toMatrixUploadError(new Error('encryption failed'), 'create'),
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );

    expect(uploadMock.startUpload).not.toHaveBeenCalled();
    expect(output).toContain(prepareUploadMessage);
    expect(output).not.toContain('Retry');
  });

  it('binds encrypted-room prep-error items with a plaintext upload block', () => {
    const file = createFile();
    const prepError = toMatrixUploadError(new Error('encryption failed'), 'create');
    uploadMock.upload = {
      file,
      status: 'idle',
    };

    renderText(
      React.createElement(UploadCardRenderer, {
        isEncrypted: true,
        fileItem: {
          file,
          originalFile: file,
          metadata: {
            markedAsSpoiler: false,
          },
          encInfo: undefined,
          prepError,
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );

    expect(uploadMock.useBindUploadAtom).toHaveBeenCalledWith(
      expect.anything(),
      'room-upload-atom',
      expect.objectContaining({
        hideFilename: false,
        blockUploadError: prepError,
      })
    );
  });

  it('renders friendly transient MatrixError text in the compact upload card', () => {
    const file = createFile();
    setUploadError(file);

    const output = renderText(
      React.createElement(CompactUploadCardRenderer, {
        uploadAtom: 'upload-atom',
        onRemove: vi.fn(),
      })
    );

    expect(output).toContain(friendlyTransientMessage);
    expect(output).not.toContain('M_UNKNOWN: Unknown message');
  });

  it('prevents compact avatar uploads that exceed media config with precise size copy', () => {
    const file = createFile({
      name: 'avatar.png',
      size: 2_500_000,
    });
    uploadMock.mediaConfig = {
      'm.upload.size': 1_000_000,
    };
    uploadMock.upload = {
      file,
      status: 'idle',
    };

    const output = renderText(
      React.createElement(CompactUploadCardRenderer, {
        uploadAtom: 'upload-atom',
        uploadKind: 'avatar',
        onRemove: vi.fn(),
      })
    );

    expect(output).toContain(
      'Avatar image is too large. Maximum upload size is 1.0 MB; selected file is 2.5 MB.'
    );
    expect(uploadMock.startUpload).not.toHaveBeenCalled();
  });

  it('preserves create-stage prep error text in the compact upload card', () => {
    const file = createFile();
    uploadMock.upload = {
      file,
      status: 'error',
      error: toMatrixUploadError(new Error('encryption failed'), 'create'),
    };

    const output = renderText(
      React.createElement(CompactUploadCardRenderer, {
        uploadAtom: 'upload-atom',
        onRemove: vi.fn(),
      })
    );

    expect(output).toContain(prepareUploadMessage);
    expect(output).not.toContain(friendlyTransientMessage);
  });

  it('renders compact avatar HTTP 413 errors as too-large instead of connection dropped', () => {
    const file = createFile({
      name: 'avatar.png',
      size: 2_500_000,
    });
    setUploadError(file, new MatrixError({ errcode: 'M_UNKNOWN', error: '' }, 413));

    const output = renderText(
      React.createElement(CompactUploadCardRenderer, {
        uploadAtom: 'upload-atom',
        uploadKind: 'avatar',
        onRemove: vi.fn(),
      })
    );

    expect(output).toContain('Avatar image is too large for this server. Choose a smaller image.');
    expect(output).not.toContain(friendlyTransientMessage);
  });
});
