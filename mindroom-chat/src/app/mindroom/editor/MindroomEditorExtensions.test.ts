import parse from 'html-dom-parser';
import { ChildNode, isTag } from 'domhandler';
import { describe, expect, it } from 'vitest';

import { BlockType } from '../../components/editor/types';
import {
  formatMindroomEditorMathMarkdown,
  getMindroomEditorMathLatex,
  getMindroomEditorMathText,
  getMindroomEditorPasteMarkerElement,
  isMindroomEditorMathBlockElement,
  mindroomEditorPasteMarkerElementToCustomHtml,
  mindroomEditorPasteMarkerElementToPlainText,
  parseMindroomEditorMathBlock,
} from './MindroomEditorExtensions';

const marker =
  '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';

const getText = (node: ChildNode): string => {
  if ('data' in node && typeof node.data === 'string') return node.data;
  if (isTag(node)) return node.children.map((child) => getText(child)).join('');
  return '';
};

const parseSingleTag = (html: string) => {
  const [node] = parse(html);
  if (!isTag(node)) throw new Error('Expected one tag node.');
  return node;
};

describe('Mindroom editor extension API', () => {
  it('owns paste marker import and Matrix custom HTML export', () => {
    const node = parseSingleTag(
      [
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        marker,
        '</span>',
      ].join('')
    );

    const element = getMindroomEditorPasteMarkerElement(node, getText);

    expect(element).toEqual({
      type: BlockType.PasteMarker,
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      marker,
      children: [{ text: '' }],
    });
    expect(mindroomEditorPasteMarkerElementToCustomHtml(element!)).toBe(
      [
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
        '</span>',
      ].join('')
    );
    expect(mindroomEditorPasteMarkerElementToPlainText(element!)).toBe(marker);
  });

  it('owns Matrix math editor markdown reconstruction', () => {
    const inlineNode = parseSingleTag('<span data-mx-maths="x^2">fallback</span>');
    const blockNode = parseSingleTag(`<div data-mx-maths="a\r
b">fallback</div>`);

    expect(getMindroomEditorMathLatex(inlineNode, getText)).toBe('x^2');
    expect(formatMindroomEditorMathMarkdown('x^2', false)).toBe('$x^2$');
    expect(getMindroomEditorMathText(inlineNode, getText, true)).toBe('$x^2$');
    expect(getMindroomEditorMathText(inlineNode, getText, false)).toBe('x^2');
    expect(isMindroomEditorMathBlockElement(inlineNode)).toBe(false);
    expect(isMindroomEditorMathBlockElement(blockNode)).toBe(true);
    expect(parseMindroomEditorMathBlock(blockNode, getText)).toEqual([
      {
        type: BlockType.Paragraph,
        children: [{ text: 'a' }],
      },
      {
        type: BlockType.Paragraph,
        children: [{ text: 'b' }],
      },
    ]);
    expect(parseMindroomEditorMathBlock(blockNode, getText, true)).toEqual([
      {
        type: BlockType.Paragraph,
        children: [{ text: '$$' }],
      },
      {
        type: BlockType.Paragraph,
        children: [{ text: 'a' }],
      },
      {
        type: BlockType.Paragraph,
        children: [{ text: 'b' }],
      },
      {
        type: BlockType.Paragraph,
        children: [{ text: '$$' }],
      },
    ]);
  });
});
