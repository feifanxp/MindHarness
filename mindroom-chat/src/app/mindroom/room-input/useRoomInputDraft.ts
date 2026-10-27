import { useStore } from 'jotai';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { Editor, Transforms } from 'slate';
import { isEmptyEditor, resetEditor, resetEditorHistory } from '../../components/editor/utils';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../../state/room/roomInputDrafts';

export const useRoomInputDraft = (
  editor: Editor,
  userId: string,
  roomId: string,
  threadId?: string
) => {
  const store = useStore();
  const draftAtom = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(userId, roomId, threadId));
  const activeRef = useRef<{ editor: Editor; atom: typeof draftAtom }>();
  const savingRef = useRef(false);

  const saveDraft = useCallback(() => {
    if (activeRef.current?.editor !== editor || activeRef.current.atom !== draftAtom) return;
    const draft = isEmptyEditor(editor) ? [] : editor.children;
    if (JSON.stringify(draft) === JSON.stringify(store.get(draftAtom))) return;
    savingRef.current = true;
    try {
      store.set(draftAtom, draft);
    } finally {
      savingRef.current = false;
    }
  }, [draftAtom, editor, store]);

  useLayoutEffect(() => {
    const restoreDraft = () => {
      if (savingRef.current) return;
      const draft = store.get(draftAtom);
      resetEditor(editor);
      if (draft.length > 0) Transforms.insertFragment(editor, JSON.parse(JSON.stringify(draft)));
      resetEditorHistory(editor);
    };
    restoreDraft();
    activeRef.current = { editor, atom: draftAtom };
    const unsubscribe = store.sub(draftAtom, restoreDraft);
    return () => {
      saveDraft();
      activeRef.current = undefined;
      unsubscribe();
      resetEditor(editor);
      resetEditorHistory(editor);
    };
  }, [draftAtom, editor, saveDraft, store]);

  return saveDraft;
};
