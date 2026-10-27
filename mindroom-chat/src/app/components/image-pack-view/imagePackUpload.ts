import { PackImage, PackImageReader } from '../../plugins/custom-emoji';
import { UploadSuccess } from '../../state/upload';
import { getImageFileUrl, loadImageElement } from '../../utils/dom';
import { getImageInfo } from '../../utils/matrix';
import { getFileNameWithoutExt } from '../../utils/mimeTypes';

export const readImagePackUpload = async (
  data: UploadSuccess
): Promise<PackImageReader | undefined> => {
  const objectUrl = getImageFileUrl(data.file);
  try {
    const imgEl = await loadImageElement(objectUrl);
    const packImage: PackImage = {
      url: data.mxc,
      info: getImageInfo(imgEl, data.file),
    };
    return PackImageReader.fromPackImage(getFileNameWithoutExt(data.file.name), packImage);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
