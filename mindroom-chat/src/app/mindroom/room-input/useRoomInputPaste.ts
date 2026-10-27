import { ClipboardEventHandler, useCallback, useLayoutEffect, useRef } from 'react';
import { useStore } from 'jotai';
import { Editor } from 'slate';
import { BlockType } from '../../components/editor/types';

import {
  customHtmlEqualsPlainText,
  moveCursor,
  toMatrixCustomHTML,
  toPlainText,
  trimCustomHtml,
} from '../../components/editor';
import {
  TUploadItem,
  TUploadMetadata,
  captureRoomInputDraftGuard,
  roomIdToMsgDraftAtomFamily,
} from '../../state/room/roomInputDrafts';
import { getDataTransferFiles } from '../../utils/dom';
import {
  createMindroomPasteAttachment,
  parseMindroomPasteMarker,
} from '../messages/pasteAttachmentMarker';
import { createMindroomRoomInputPasteMarkerElement } from './RoomInputMindroomExtensions';
import { shouldConvertPasteToAttachment } from './pasteAttachment';

type UseRoomInputPasteOptions = {
  editor: Editor;
  draftKey?: string;
  isMarkdown: boolean;
  handleFiles: (files: File[]) => Promise<void>;
  createUploadItems: (
    files: File[],
    getMetadata?: (file: File, index: number) => TUploadMetadata
  ) => Promise<TUploadItem[]>;
  appendUploadItems: (fileItems: TUploadItem[]) => void;
};

export const useRoomInputPaste = ({
  editor,
  draftKey,
  isMarkdown,
  handleFiles,
  createUploadItems,
  appendUploadItems,
}: UseRoomInputPasteOptions): ClipboardEventHandler => {
  const store = useStore();
  const activeDraftRef = useRef(draftKey);
  activeDraftRef.current = draftKey;
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Must stay synchronous and return `undefined` when it does not handle the
  // paste: slate-react treats any non-null return value (including the
  // Promise from an async handler) as "handled" and then skips its own
  // onPaste fallback, so the browser inserts the text into the DOM without
  // the editor model ever learning about it.
  const handlePaste: ClipboardEventHandler = useCallback(
    (evt) => {
      const files = getDataTransferFiles(evt.clipboardData);
      if (files) {
        void handleFiles(files);
        return;
      }

      const pastedText = evt.clipboardData.getData('text/plain');
      if (!pastedText) return;

      const plainText = toPlainText(editor.children, isMarkdown).trim();
      const customHtml = trimCustomHtml(
        toMatrixCustomHTML(editor.children, {
          allowTextFormatting: true,
          allowBlockMarkdown: isMarkdown,
          allowInlineMarkdown: isMarkdown,
        })
      );
      const hasFormattedBody = !customHtmlEqualsPlainText(customHtml, plainText);
      const convertPaste = shouldConvertPasteToAttachment({
        currentPlainText: plainText,
        currentFormattedBody: hasFormattedBody ? customHtml : undefined,
        pastedText,
        includeFormattedPaste: isMarkdown,
      });

      if (!convertPaste) return;

      evt.preventDefault();
      const pasteAttachment = createMindroomPasteAttachment(pastedText);
      const pasteMarker = parseMindroomPasteMarker(pasteAttachment.marker);
      if (!pasteMarker) return;

      const canRecover = draftKey ? captureRoomInputDraftGuard(draftKey) : () => true;
      void (async () => {
        const pasteUploadItems = await createUploadItems([pasteAttachment.file], () => ({
          markedAsSpoiler: false,
          mindroomPasteAttachment: {
            id: pasteMarker.id,
            chars: pasteMarker.chars,
            fileName: pasteMarker.fileName,
          },
        }));
        if (!canRecover()) return;
        appendUploadItems(pasteUploadItems);
        const preparationFailed = pasteUploadItems.some((item) => item.prepError);
        if (draftKey && (!mountedRef.current || activeDraftRef.current !== draftKey)) {
          // Preparation can finish after navigation. Append to the captured destination
          // instead of inserting into the editor now displaying a different draft.
          const draftAtom = roomIdToMsgDraftAtomFamily(draftKey);
          const fragment = preparationFailed
            ? { type: BlockType.Paragraph as const, children: [{ text: pastedText }] }
            : createMindroomRoomInputPasteMarkerElement(pasteMarker);
          store.set(draftAtom, [...store.get(draftAtom), fragment]);
          return;
        }
        if (preparationFailed) {
          editor.insertText(pastedText);
          return;
        }

        editor.insertNode(createMindroomRoomInputPasteMarkerElement(pasteMarker));
        moveCursor(editor);
      })();
    },
    [appendUploadItems, createUploadItems, draftKey, editor, handleFiles, isMarkdown, store]
  );

  return handlePaste;
};
