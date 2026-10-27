import type { TUploadItem } from '../../state/room/roomInputDrafts';
import type { Upload } from '../../state/upload';
import type { TUploadContent } from '../../utils/matrix';

export type AttachmentSnapshot = {
  staged: TUploadItem[];
  enrolled: TUploadItem[];
  uploads: Upload[];
};

export type RoomInputAttachmentAccess = {
  /** Without a room, returns the active composer; explicit rooms include all staged drafts. */
  snapshot: (roomId?: string) => AttachmentSnapshot;
  append: (roomId: string, items: TUploadItem[]) => void;
  remove: (roomId: string, files: TUploadContent[]) => void;
  enroll: (items: TUploadItem[]) => void;
  clearEnrollment: () => void;
  protectPasteItems: (items: TUploadItem[]) => () => void;
  subscribe: (listener: () => void) => () => void;
};
