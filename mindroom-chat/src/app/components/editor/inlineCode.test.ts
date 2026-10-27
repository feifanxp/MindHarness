import type { Descendant } from 'slate';
import { expect, it } from 'vitest';
import { htmlToEditorInput } from './input';
import { toMatrixCustomHTML, toPlainText, trimCustomHtml } from './output';
import { BlockType } from './types';

it('round-trips Markdown emphasis containing inline code through the editor', () => {
  const markdown = '**Pointed `config.yaml` at it**';
  const nodes = [{ type: BlockType.Paragraph, children: [{ text: markdown }] }] as Descendant[];
  const html = trimCustomHtml(
    toMatrixCustomHTML(nodes, { allowInlineMarkdown: true, allowBlockMarkdown: true })
  );

  expect(html).toBe(
    '<strong data-md="**">Pointed <code data-md="`">config.yaml</code> at it</strong>'
  );
  expect(toPlainText(htmlToEditorInput(html, true), true).trim()).toBe(markdown);
});
