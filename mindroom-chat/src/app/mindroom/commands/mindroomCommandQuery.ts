import { BaseRange, Editor, Range, Transforms } from 'slate';
import type { AutocompleteQuery } from '../../components/editor/autocomplete/autocompleteQuery';

export const MINDROOM_COMMAND_PREFIX = '!' as const;

export const getMindroomCommandQuery = (
  editor: Editor,
  prevWordRange: BaseRange
): AutocompleteQuery<typeof MINDROOM_COMMAND_PREFIX> | undefined => {
  if (!editor.selection || !Range.isCollapsed(editor.selection)) return undefined;

  const word = Editor.string(editor, prevWordRange);
  if (!word.startsWith(MINDROOM_COMMAND_PREFIX)) return undefined;

  const start = Editor.start(editor, []);
  const queryStart = Range.start(prevWordRange);
  const prefixText = Editor.string(editor, {
    anchor: start,
    focus: queryStart,
  });
  if (prefixText.trim().length > 0) return undefined;

  return {
    range: prevWordRange,
    prefix: MINDROOM_COMMAND_PREFIX,
    text: word.slice(1),
  };
};

export const insertMindroomCommand = (editor: Editor, range: BaseRange, commandName: string) => {
  Transforms.select(editor, range);
  Editor.insertText(editor, `!${commandName} `);
};
