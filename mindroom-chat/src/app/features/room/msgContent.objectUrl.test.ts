import { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUploadItem } from '../../state/room/roomInputDrafts';
import { getImageMsgContent, getVideoMsgContent } from './msgContent';

const mocks = vi.hoisted(() => ({
  encodeBlurHash: vi.fn(() => 'blur-hash'),
  getImageInfo: vi.fn(() => ({ h: 1, mimetype: 'image/png', size: 1, w: 1 })),
  loadImageElement: vi.fn(),
  loadVideoElement: vi.fn(),
}));

vi.mock('../../utils/blurHash', async () => {
  const actual = await vi.importActual<typeof import('../../utils/blurHash')>(
    '../../utils/blurHash'
  );
  return {
    ...actual,
    encodeBlurHash: mocks.encodeBlurHash,
  };
});

vi.mock('../../utils/dom', async () => {
  const actual = await vi.importActual<typeof import('../../utils/dom')>('../../utils/dom');
  return {
    ...actual,
    loadImageElement: mocks.loadImageElement,
    loadVideoElement: mocks.loadVideoElement,
  };
});

vi.mock('../../utils/matrix', async () => {
  const actual = await vi.importActual<typeof import('../../utils/matrix')>('../../utils/matrix');
  return {
    ...actual,
    getImageInfo: mocks.getImageInfo,
  };
});

const createUploadItem = (file: File): TUploadItem => ({
  file,
  originalFile: file,
  encInfo: undefined,
  metadata: {
    markedAsSpoiler: false,
  },
});

describe('upload metadata object URL ownership', () => {
  const outstandingUrls = new Set<string>();
  let nextObjectUrl = 0;

  beforeEach(() => {
    nextObjectUrl = 0;
    outstandingUrls.clear();
    mocks.loadImageElement.mockReset();
    mocks.loadVideoElement.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const objectUrl = `blob:upload-metadata-${nextObjectUrl}`;
      nextObjectUrl += 1;
      outstandingUrls.add(objectUrl);
      return objectUrl;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((objectUrl) => {
      outstandingUrls.delete(objectUrl);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves no outstanding URL after image success or video metadata failure', async () => {
    const imageFile = new File(['image'], 'image.png', { type: 'image/png' });
    mocks.loadImageElement.mockResolvedValue({
      height: 1,
      width: 1,
    } as HTMLImageElement);

    await getImageMsgContent(
      {} as MatrixClient,
      createUploadItem(imageFile),
      'mxc://matrix.localhost/image'
    );
    expect(outstandingUrls).toHaveLength(0);

    const videoFile = new File(['video'], 'video.mp4', { type: 'video/mp4' });
    mocks.loadVideoElement.mockRejectedValue(new Error('metadata unavailable'));

    await getVideoMsgContent(
      {} as MatrixClient,
      createUploadItem(videoFile),
      'mxc://matrix.localhost/video'
    );
    expect(outstandingUrls).toHaveLength(0);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
