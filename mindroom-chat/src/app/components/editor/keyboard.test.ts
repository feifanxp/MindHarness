import { KeyboardEvent } from 'react';
import { createEditor } from 'slate';
import { describe, expect, it, vi } from 'vitest';
import { toggleKeyboardShortcut } from './keyboard';
import { BlockType } from './types';

type ModifierKey = 'ctrlKey' | 'metaKey';

const modNumberEvent = (key: string, modifierKey: ModifierKey) =>
  ({
    key,
    altKey: false,
    ctrlKey: modifierKey === 'ctrlKey',
    metaKey: modifierKey === 'metaKey',
    shiftKey: false,
    preventDefault: vi.fn(),
  } as KeyboardEvent<Element>);

const shortcutCases = [
  ...['1', '2', '3'].map((key) => ({
    key,
    modifierKey: 'metaKey' as const,
  })),
  ...['1', '2', '3'].map((key) => ({
    key,
    modifierKey: 'ctrlKey' as const,
  })),
];

describe('toggleKeyboardShortcut', () => {
  it.each(shortcutCases)(
    'leaves the browser $modifierKey+$key shortcut unhandled',
    ({ key, modifierKey }) => {
      const editor = createEditor();
      editor.children = [
        {
          type: BlockType.Paragraph,
          children: [{ text: 'Composer text' }],
        },
      ];
      editor.selection = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      };

      const event = modNumberEvent(key, modifierKey);
      expect(toggleKeyboardShortcut(editor, event)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(editor.children).toEqual([
        {
          type: BlockType.Paragraph,
          children: [{ text: 'Composer text' }],
        },
      ]);
    }
  );
});
