import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadStatus } from '../../state/upload';
import { readImagePackUpload } from './imagePackUpload';

const mocks = vi.hoisted(() => ({
  getImageInfo: vi.fn(() => ({ h: 1, mimetype: 'image/png', size: 1, w: 1 })),
  loadImageElement: vi.fn(),
}));

vi.mock('../../utils/dom', async () => {
  const actual = await vi.importActual<typeof import('../../utils/dom')>('../../utils/dom');
  return {
    ...actual,
    loadImageElement: mocks.loadImageElement,
  };
});

vi.mock('../../utils/matrix', async () => {
  const actual = await vi.importActual<typeof import('../../utils/matrix')>('../../utils/matrix');
  return {
    ...actual,
    getImageInfo: mocks.getImageInfo,
  };
});

describe('image-pack upload object URL ownership', () => {
  const outstandingUrls = new Set<string>();
  let nextObjectUrl = 0;

  beforeEach(() => {
    nextObjectUrl = 0;
    outstandingUrls.clear();
    mocks.loadImageElement.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const objectUrl = `blob:image-pack-${nextObjectUrl}`;
      nextObjectUrl += 1;
      outstandingUrls.add(objectUrl);
      return objectUrl;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((objectUrl) => {
      outstandingUrls.delete(objectUrl);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes the upload URL after successful image-pack metadata extraction', async () => {
    const file = new File(['image'], 'party-parrot.png', { type: 'image/png' });
    mocks.loadImageElement.mockResolvedValue({ height: 1, width: 1 } as HTMLImageElement);

    const image = await readImagePackUpload({
      file,
      mxc: 'mxc://matrix.localhost/party-parrot',
      status: UploadStatus.Success,
    });

    expect(image?.shortcode).toBe('party-parrot');
    expect(outstandingUrls).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the upload URL when image-pack metadata extraction fails', async () => {
    const file = new File(['broken'], 'broken.png', { type: 'image/png' });
    mocks.loadImageElement.mockRejectedValue(new Error('metadata unavailable'));

    await expect(
      readImagePackUpload({
        file,
        mxc: 'mxc://matrix.localhost/broken',
        status: UploadStatus.Success,
      })
    ).rejects.toThrow('metadata unavailable');

    expect(outstandingUrls).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
