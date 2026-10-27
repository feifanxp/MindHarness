import { createEditor } from 'slate';
import { describe, expect, it } from 'vitest';
import { restoreEditorContent } from './utils';

describe('restoreEditorContent', () => {
  it('restores a failed submission without replacing newer editor content', () => {
    const editor = createEditor();
    editor.children = [
      {
        type: 'paragraph',
        children: [{ text: 'Newer composer input' }],
      },
    ];

    restoreEditorContent(editor, [
      {
        type: 'paragraph',
        children: [{ text: 'Failed submitted reply' }],
      },
    ]);

    expect(editor.children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'Failed submitted reply' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'Newer composer input' }],
      },
    ]);
  });
});
