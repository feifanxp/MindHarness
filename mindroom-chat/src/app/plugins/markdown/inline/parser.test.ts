import { describe, expect, it } from 'vitest';
import { parseInlineMD } from './parser';
import { escapeMarkdownInlineSequences, unescapeMarkdownInlineSequences } from '../utils';

describe('inline Markdown containing code', () => {
  it('handles long control-character input without repeated delimiter searches', () => {
    const prefix = '\u0000'.repeat(262144);
    const start = performance.now();
    expect(parseInlineMD(`${prefix}**a \`x\` b**`)).toBe(
      `${prefix}<strong data-md="**">a <code data-md="\`">x</code> b</strong>`
    );
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('cannot confuse literal token-shaped text with protected code', () => {
    expect(parseInlineMD('\u00000:0\u00000: **a `x` b**')).toBe(
      '\u00000:0\u00000: <strong data-md="**">a <code data-md="`">x</code> b</strong>'
    );
  });
  it.each([
    ['**a `x` b**', '<strong data-md="**">a <code data-md="`">x</code> b</strong>'],
    ['**a `**` b**', '<strong data-md="**">a <code data-md="`">**</code> b</strong>'],
    ['*a `x` b*', '<i data-md="*">a <code data-md="`">x</code> b</i>'],
    ['~~a `x` b~~', '<s data-md="~~">a <code data-md="`">x</code> b</s>'],
    ['`**not bold**`', '<code data-md="`">**not bold**</code>'],
    ['`a` and `b`', '<code data-md="`">a</code> and <code data-md="`">b</code>'],
    [
      '[a `x`](https://example.org)',
      '<a data-md href="https://example.org">a <code data-md="`">x</code></a>',
    ],
    ['[x](https://example.org/`y`)', '<a data-md href="https://example.org/`y`">x</a>'],
    ['$a `b` c$', '<span data-mx-maths="a `b` c">a `b` c</span>'],
    [
      '\u00000\u0000 **a `x` b**',
      '\u00000\u0000 <strong data-md="**">a <code data-md="`">x</code> b</strong>',
    ],
  ])('renders %s without interpreting code contents as Markdown', (markdown, html) => {
    expect(parseInlineMD(markdown)).toBe(html);
  });
});

describe('inline Markdown next to URLs', () => {
  it.each([
    ['https://example.org/a_b_c_d', 'https://example.org/a_b_c_d'],
    [
      'see https://example.org/**a** and **b**',
      'see https://example.org/**a** and <strong data-md="**">b</strong>',
    ],
    ['ftp://host/~~x~~ ~~y~~', 'ftp://host/~~x~~ <s data-md="~~">y</s>'],
    ['*a* mailto://b*c* *d*', '<i data-md="*">a</i> mailto://b*c* <i data-md="*">d</i>'],
    ['https://example.org/\\*x\\*', 'https://example.org/\\*x\\*'],
  ])('keeps markers inside URLs literal in %s', (markdown, html) => {
    expect(parseInlineMD(markdown)).toBe(html);
  });

  it('escapes markers outside URLs only', () => {
    expect(escapeMarkdownInlineSequences('https://example.org/a_b and a_b')).toBe(
      'https://example.org/a_b and a\\_b'
    );
    expect(unescapeMarkdownInlineSequences('https://example.org/a\\_b and a\\_b')).toBe(
      'https://example.org/a\\_b and a_b'
    );
  });
});
