import { Element, htmlToDOM } from 'html-react-parser';
import { describe, expect, it } from 'vitest';
import { getRenderedMindroomToolRefs, getToolRefPrefixFromElement } from './toolRefDom';

const indexesOf = (html: string) =>
  getRenderedMindroomToolRefs(html).toolBlocks.map(({ index, toolName }) => [index, toolName]);

// Parity with the full renderer lives in react-custom-html-parser.test.ts,
// which renders the backend fixtures with the app's real base parser.
describe('getRenderedMindroomToolRefs', () => {
  it('reads leading markers of top-level paragraphs, divs, and list items', () => {
    expect(
      indexesOf(
        '<p>🔧 <code>a</code> [1]</p><div>🔧 <code>b</code> [2] ⏳</div><li>🔧 <code>c</code> [3]</li>'
      )
    ).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('follows markers in the content the renderer re-wraps after a marker', () => {
    expect(indexesOf('<p>🔧 <code>a</code> [1]<br>\n🔧 <code>b</code> [2]<br>tail</p>')).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('ignores markers in code, mid-paragraph, nested containers, or loose text', () => {
    expect(
      indexesOf(
        [
          '<pre><code>🔧 `a` [1]</code></pre>',
          '<p>text<br>🔧 <code>b</code> [2]</p>',
          '<ul><li>🔧 <code>c</code> [3]</li></ul>',
          '<blockquote><p>🔧 <code>d</code> [4]</p></blockquote>',
          '🔧 <code>e</code> [5]',
        ].join('')
      )
    ).toEqual([]);
  });

  it('counts every rendered 🔧 and those inside tool-block markers', () => {
    expect(
      getRenderedMindroomToolRefs(
        '<p>🔧 <code>x</code> [1]</p><pre><code>🔧 `x` [1]</code></pre><p>🔧 <code>🔧</code> [2]</p>'
      )
    ).toMatchObject({ iconCount: 4, toolBlockIconCount: 3 });
  });
});

describe('getToolRefPrefixFromElement', () => {
  const elementOf = (html: string) => htmlToDOM(html)[0] as Element;
  const prefixOf = (html: string) => {
    const prefix = getToolRefPrefixFromElement(elementOf(html));
    return prefix && { html: prefix.html, trailing: prefix.trailingChildren.length };
  };

  it('finds the marker without parsing every prefix of a long paragraph', () => {
    expect(prefixOf('<p>🔧 <code>a</code> [1] ⏳ tail</p>')).toEqual({
      html: '🔧 <code>a</code> [1] ⏳ ',
      trailing: 1,
    });
    expect(prefixOf('<p> 🔧 <code>a</code><span> [2]</span><br>tail</p>')).toEqual({
      html: ' 🔧 <code>a</code> [2]',
      trailing: 1,
    });
    expect(prefixOf('<p>🔧 <code>a</code><span> [1]x</span></p>')).toBeUndefined();

    // Parsing each prefix scanned it again, so one long paragraph froze every viewer.
    const longText = elementOf(`<p>🔧 ${'&lt;code&gt;x🔧 '.repeat(5_000)}</p>`);
    const manyChildren = elementOf(`<p>🔧 ${'<code>x</code>'.repeat(5_000)}</p>`);
    const start = performance.now();
    expect(getToolRefPrefixFromElement(longText)).toBeUndefined();
    expect(getToolRefPrefixFromElement(manyChildren)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(100);
  });
});
