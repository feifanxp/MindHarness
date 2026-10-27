import { createEditor, Editor, Node, Transforms } from 'slate';
import { HistoryEditor, withHistory } from 'slate-history';
import { describe, expect, it } from 'vitest';
import { withWordUndo } from './history';
import { BlockType } from './types';

const makeEditor = () => {
  const editor = withWordUndo(withHistory(createEditor()));
  editor.children = [{ type: BlockType.Paragraph, children: [{ text: '' }] }];
  Transforms.select(editor, Editor.end(editor, []));
  return editor;
};

const text = (editor: Editor) => Node.string(editor);

// Slate clears `editor.operations` in a microtask, so each keystroke is its own change.
const type = async (editor: Editor, value: string) => {
  for (const char of value) {
    Editor.insertText(editor, char);
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

const undoAll = (editor: Editor) => {
  const states: string[] = [];
  while (editor.history.undos.length > 0) {
    editor.undo();
    states.push(text(editor));
  }
  return states;
};

describe('withWordUndo', () => {
  it('undoes typed text one word at a time', async () => {
    const editor = makeEditor();
    await type(editor, 'hello world again');

    expect(undoAll(editor)).toEqual(['hello world ', 'hello ', '']);
  });

  it('keeps a single word one undo step', async () => {
    const editor = makeEditor();
    await type(editor, 'hello');

    expect(undoAll(editor)).toEqual(['']);
  });

  it('keeps runs of whitespace with the word before them', async () => {
    const editor = makeEditor();
    await type(editor, 'a  b');

    expect(undoAll(editor)).toEqual(['a  ', '']);
  });

  it('makes a pasted sentence its own undo step', async () => {
    const editor = makeEditor();
    await type(editor, 'hi ');
    Editor.insertText(editor, 'hello world again');
    await Promise.resolve();

    expect(undoAll(editor)).toEqual(['hi ', '']);
  });

  it('does not split one change that inserts several words', async () => {
    const editor = makeEditor();
    Editor.insertText(editor, 'hello ');
    Editor.insertText(editor, 'world');
    await Promise.resolve();

    expect(undoAll(editor)).toEqual(['']);
  });

  it('starts a word step when the keystroke first moves the selection', async () => {
    const editor = makeEditor();
    await type(editor, 'hello ');
    Transforms.select(editor, Editor.start(editor, []));
    Transforms.select(editor, Editor.end(editor, []));
    Editor.insertText(editor, 'w');
    await Promise.resolve();

    expect(undoAll(editor)).toEqual(['hello ', '']);
  });

  it('leaves a caller-chosen merge alone', async () => {
    const editor = makeEditor();
    await type(editor, 'hello ');
    HistoryEditor.withMerging(editor, () => Editor.insertText(editor, 'w'));
    await Promise.resolve();

    expect(undoAll(editor)).toEqual(['']);
  });

  it('redoes one word at a time', async () => {
    const editor = makeEditor();
    await type(editor, 'hello world');
    editor.undo();
    editor.undo();

    editor.redo();
    expect(text(editor)).toBe('hello ');
    editor.redo();
    expect(text(editor)).toBe('hello world');
  });
});
