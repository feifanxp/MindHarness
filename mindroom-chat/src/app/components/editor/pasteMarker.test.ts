import type { Descendant } from 'slate';
import { describe, expect, it } from 'vitest';
import { htmlToEditorInput } from './input';
import { toMatrixCustomHTML, toPlainText, trimCustomHtml } from './output';
import { BlockType } from './types';

const marker =
  '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';

const pasteMarkerElement = {
  type: BlockType.PasteMarker,
  id: 'paste-a3f19c',
  chars: 11,
  fileName: 'mindroom-paste-a3f19c.txt',
  marker,
  children: [{ text: '' }],
};

describe('editor paste marker integration', () => {
  it('serializes paste marker nodes as exact marker text and formatted badge spans', () => {
    const nodes = [
      {
        type: BlockType.Paragraph,
        children: [{ text: 'Before ' }, pasteMarkerElement, { text: ' after' }],
      },
    ] as unknown as Descendant[];

    expect(toPlainText(nodes, false).trim()).toBe(`Before ${marker} after`);
    expect(trimCustomHtml(toMatrixCustomHTML(nodes, { allowTextFormatting: true }))).toBe(
      [
        'Before ',
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
        '</span>',
        ' after',
      ].join('')
    );
  });

  it('imports formatted paste marker spans as atomic paste marker nodes', () => {
    expect(
      htmlToEditorInput(
        [
          '<p>Before ',
          '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
          marker,
          '</span>',
          ' after</p>',
        ].join(''),
        false
      )
    ).toEqual([
      {
        type: BlockType.Paragraph,
        children: [{ text: 'Before ' }, pasteMarkerElement, { text: ' after' }],
      },
    ]);
  });
});
