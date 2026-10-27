/* eslint-disable no-param-reassign */
import { Editor } from 'slate';
import { HistoryEditor } from 'slate-history';

/**
 * slate-history merges every run of contiguous typing into one undo step, so
 * undo after typing a sentence removed the whole sentence. Start a new step
 * when a keystroke begins a word after whitespace, so undo removes one word.
 * Must wrap `withHistory` directly so it decides before history records the op.
 */
export const withWordUndo = (editor: Editor): Editor => {
  const { apply } = editor;

  editor.apply = (op) => {
    const { undos } = editor.history;
    const lastBatch = undos[undos.length - 1];
    const lastOp = lastBatch?.operations[lastBatch.operations.length - 1];
    const startsWord =
      op.type === 'insert_text' &&
      lastOp?.type === 'insert_text' &&
      /\s$/.test(lastOp.text) &&
      /^\S/.test(op.text);
    // Only a change's first saved op (history skips selection ops; slate-react
    // often selects before inserting), and only where no caller chose how to merge.
    if (
      startsWord &&
      editor.operations.every(({ type }) => type === 'set_selection') &&
      HistoryEditor.isMerging(editor) == null
    ) {
      HistoryEditor.withoutMerging(editor, () => apply(op));
      return;
    }
    apply(op);
  };

  return editor;
};
