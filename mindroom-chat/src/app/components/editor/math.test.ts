import type { Descendant } from 'slate';
import { describe, expect, it } from 'vitest';
import { htmlToEditorInput } from './input';
import { toMatrixCustomHTML, toPlainText, trimCustomHtml } from './output';
import { BlockType } from './types';

const markdownOutputOptions = {
  allowInlineMarkdown: true,
  allowBlockMarkdown: true,
};

const paragraph = (text: string): Descendant =>
  ({
    type: BlockType.Paragraph,
    children: [{ text }],
  } as unknown as Descendant);

describe('editor math markdown integration', () => {
  it('emits Matrix inline math html from markdown compose', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML([paragraph('$x^2$')], markdownOutputOptions)
    );

    expect(customHtml).toContain('<span data-mx-maths="x^2">x^2</span>');
  });

  it('emits Matrix display math html from markdown compose', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML([paragraph('$$\\frac{a}{b}$$')], markdownOutputOptions)
    );

    expect(customHtml).toBe('<div data-mx-maths="\\frac{a}{b}">\\frac{a}{b}</div>');
  });

  it('does not treat currency as math during compose', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML([paragraph('$5+$10$')], markdownOutputOptions)
    );

    expect(customHtml).toBe('$5+$10$');
  });

  it('does not treat formatted currency amounts as math during compose', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML(
        [paragraph('$1234$ and $1,000.00$ and $1.000,00$ and $5 USD$')],
        markdownOutputOptions
      )
    );

    expect(customHtml).toBe('$1234$ and $1,000.00$ and $1.000,00$ and $5 USD$');
  });

  it('does not treat currency ranges as math during compose', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML([paragraph('$5-10$ and $5–10$ and $5-$10$')], markdownOutputOptions)
    );

    expect(customHtml).toBe('$5-10$ and $5–10$ and $5-$10$');
  });

  it('still treats numeric-leading expressions as math during compose', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML([paragraph('$2sin(x)$')], markdownOutputOptions)
    );

    expect(customHtml).toContain('<span data-mx-maths="2sin(x)">2sin(x)</span>');
  });

  it('preserves escaped dollar delimiters as literal text during compose', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML([paragraph('\\$escaped\\$')], markdownOutputOptions)
    );

    expect(customHtml).toBe('$escaped$');
  });

  it('reconstructs inline and display math delimiters from incoming Matrix html', () => {
    const inlineNodes = htmlToEditorInput('<p><span data-mx-maths="x^2">x^2</span></p>', true);
    const blockNodes = htmlToEditorInput(
      '<div data-mx-maths="\\frac{a}{b}">\\frac{a}{b}</div>',
      true
    );

    expect(inlineNodes).toEqual([
      {
        type: BlockType.Paragraph,
        children: [{ text: '$x^2$' }],
      },
    ]);
    expect(blockNodes).toEqual([
      {
        type: BlockType.Paragraph,
        children: [{ text: '$$\\frac{a}{b}$$' }],
      },
    ]);
  });

  it('keeps blockquote display math as raw markdown text instead of emitting nested block math', () => {
    const customHtml = trimCustomHtml(
      toMatrixCustomHTML([paragraph('> $$\\frac{a}{b}$$')], markdownOutputOptions)
    );
    const roundTripNodes = htmlToEditorInput(customHtml, true);
    const importedNestedNodes = htmlToEditorInput(
      '<blockquote data-md=">"><div data-mx-maths="\\frac{a}{b}">\\frac{a}{b}</div></blockquote>',
      true
    );

    expect(customHtml).toBe('<blockquote data-md=">">$$\\frac{a}{b}$$<br/></blockquote>');
    expect(toPlainText(roundTripNodes, true).trim()).toBe('> $$\\frac{a}{b}$$');
    expect(toPlainText(importedNestedNodes, true).trim()).toBe('> $$\\frac{a}{b}$$');
  });
});
