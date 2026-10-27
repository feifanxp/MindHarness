import { createEditor } from 'slate';
import { describe, expect, it } from 'vitest';
import {
  getMindroomCommandQuery,
  insertMindroomCommand,
  MINDROOM_COMMAND_PREFIX,
} from './mindroomCommandQuery';

const createTextEditor = (text: string, anchorOffset = text.length, focusOffset = anchorOffset) => {
  const editor = createEditor();
  editor.children = [
    {
      type: 'paragraph',
      children: [{ text }],
    },
  ] as any;
  editor.selection = {
    anchor: { path: [0, 0], offset: anchorOffset },
    focus: { path: [0, 0], offset: focusOffset },
  };
  return editor;
};

describe('getMindroomCommandQuery', () => {
  it('returns query when command starts at beginning of message', () => {
    const editor = createTextEditor('!sch');
    const query = getMindroomCommandQuery(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 4 },
    });

    expect(query?.prefix).toBe(MINDROOM_COMMAND_PREFIX);
    expect(query?.text).toBe('sch');
  });

  it('returns undefined when command is not at beginning of message', () => {
    const editor = createTextEditor('hello !sch');
    const query = getMindroomCommandQuery(editor, {
      anchor: { path: [0, 0], offset: 6 },
      focus: { path: [0, 0], offset: 10 },
    });

    expect(query).toBeUndefined();
  });

  it('returns undefined when selection is not collapsed', () => {
    const editor = createTextEditor('!schedule', 2, 9);
    const query = getMindroomCommandQuery(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 9 },
    });

    expect(query).toBeUndefined();
  });

  it('inserts selected command as plain text', () => {
    const editor = createTextEditor('!sch');
    insertMindroomCommand(
      editor,
      {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      },
      'schedule'
    );
    expect(editor.children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: '!schedule ' }],
      },
    ]);
  });
});
