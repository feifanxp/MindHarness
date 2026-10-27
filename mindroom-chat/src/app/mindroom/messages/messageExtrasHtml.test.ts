import { describe, expect, it } from 'vitest';
import { sanitizeMindroomMessageExtraHtml } from './messageExtrasHtml';

describe('sanitizeMindroomMessageExtraHtml', () => {
  it('keeps ordinary structured HTML and safe links', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <h2>Evidence</h2>
      <p><strong>Result</strong> <em>ok</em> <code class="language-ts">value</code></p>
      <div><blockquote>quoted</blockquote><hr><br></div>
      <ol start="2" type="A"><li>first</li></ol>
      <ul><li><span>second</span></li></ul>
      <table><caption>Rows</caption><thead><tr><th>Name</th></tr></thead><tbody><tr><td>ok</td></tr></tbody></table>
      <pre class="language-js"><code>const value = 1;</code></pre>
      <a href="https://example.test/path?q=1" target="_self" rel="opener">link</a>
      <a HREF="https://example.test/caps">caps</a>
      <a href="mailto:user@example.test">mail</a>
    `);

    expect(sanitized).toContain('<h2>Evidence</h2>');
    expect(sanitized).toContain('<strong>Result</strong>');
    expect(sanitized).toContain('<code class="language-ts">value</code>');
    expect(sanitized).toContain('<blockquote>quoted</blockquote>');
    expect(sanitized).toContain('<ol start="2" type="A">');
    expect(sanitized).toContain('<table>');
    expect(sanitized).toContain('<pre class="language-js">');
    expect(sanitized).toContain(
      '<a href="https://example.test/path?q=1" target="_blank" rel="noreferrer noopener">link</a>'
    );
    expect(sanitized).toContain(
      '<a href="https://example.test/caps" target="_blank" rel="noreferrer noopener">caps</a>'
    );
    expect(sanitized).toContain(
      '<a href="mailto:user@example.test" target="_blank" rel="noreferrer noopener">mail</a>'
    );
  });

  it('keeps safe inline SVG primitives for charts, badges, and diagrams', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <svg viewBox="0 0 200 40" preserveAspectRatio="none" class="sparkline">
        <title>Sparkline</title>
        <desc>Recent status trend</desc>
        <polyline fill="none" stroke="#7d5fff" points="0,30 50,10 100,20 150,5 200,15"></polyline>
      </svg>
      <svg width="80" height="20">
        <rect width="80" height="20" rx="3" fill="#28a745"></rect>
        <text x="40" y="14" text-anchor="middle" fill="white" font-size="11">passing</text>
      </svg>
      <svg viewBox="0 0 120 60">
        <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6 z" fill="currentColor"></path></marker></defs>
        <g transform="translate(4 4)" opacity="0.9">
          <rect x="0" y="0" width="42" height="20" ry="2" stroke="black" fill="none"></rect>
          <line x1="44" y1="10" x2="78" y2="10" marker-end="url(#arrow)" stroke="black"></line>
          <circle cx="98" cy="10" r="8" fill="#7d5fff"></circle>
          <ellipse cx="20" cy="44" rx="16" ry="8" fill="none" stroke="black"></ellipse>
          <polygon points="80,36 106,44 80,52" fill="#28a745"></polygon>
          <text x="21" y="14"><tspan font-weight="700">API</tspan></text>
        </g>
      </svg>
    `);

    expect(sanitized).toContain(
      '<svg viewBox="0 0 200 40" preserveAspectRatio="none" class="sparkline">'
    );
    expect(sanitized).toContain(
      '<polyline fill="none" stroke="#7d5fff" points="0,30 50,10 100,20 150,5 200,15"></polyline>'
    );
    expect(sanitized).toContain('<rect width="80" height="20" rx="3" fill="#28a745"></rect>');
    expect(sanitized).toContain(
      '<text x="40" y="14" text-anchor="middle" fill="white" font-size="11">passing</text>'
    );
    expect(sanitized).toContain(
      '<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">'
    );
    expect(sanitized).toContain(
      '<line x1="44" y1="10" x2="78" y2="10" marker-end="url(#arrow)" stroke="black"></line>'
    );
    expect(sanitized).toContain('<tspan font-weight="700">API</tspan>');
  });

  it('strips SVG script vectors while keeping safe SVG siblings', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <svg class="safe bad@class -bad" onload="alert(1)" style="background:url(javascript:alert(1))" href="javascript:alert(1)" xlink:href="https://evil.example/x.svg#bad">
        <script>alert(1)</script>
        <circle cx="50" cy="50" r="40" onclick="alert(1)" fill="red" stroke="url(https://tracker.example/stroke.svg#paint)"></circle>
        <foreignObject><body><script>alert(1)</script></body></foreignObject>
        <use href="https://evil.com/x.svg#bad"></use>
        <image href="https://tracker.example/pixel.png"></image>
        <animate attributeName="href" values="javascript:alert(1)"></animate>
        <animateTransform attributeName="transform" type="rotate" from="0" to="360"></animateTransform>
        <animateMotion path="M0,0 L10,10"></animateMotion>
        <set attributeName="href" to="javascript:alert(1)"></set>
        <a href="javascript:alert(1)"><text>click</text></a>
        <path d="M0,0 L1,1" fill="url(https://tracker.example/fill.svg#paint)" marker-start="url(javascript:alert(1))" marker-mid="url(data:image/svg+xml;base64,PHN2Zy8+)" marker-end="url(#safe)"></path>
      </svg>
    `);

    expect(sanitized).toContain('<svg class="safe">');
    expect(sanitized).toContain('<circle cx="50" cy="50" r="40" fill="red"></circle>');
    expect(sanitized).toContain('<path d="M0,0 L1,1" marker-end="url(#safe)"></path>');
    expect(sanitized).toContain('<text>click</text>');
    const normalized = sanitized.toLowerCase();
    for (const forbidden of [
      'onload',
      'onclick',
      'style=',
      'href=',
      'xlink:href',
      '<script',
      'alert(1)',
      '<foreignobject',
      '<body',
      '<use',
      '<image',
      '<animate',
      '<animateTransform',
      '<animateMotion',
      '<set',
      'tracker.example',
      'evil.com',
      'url(https:',
      'url(javascript:',
      'url(data:',
      'bad@class',
      '-bad',
    ]) {
      expect(normalized).not.toContain(forbidden.toLowerCase());
    }
  });

  it('removes executable, embed, form, media, metadata, reply, and image surfaces', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <script>window.__mindroomExtrasXss = true</script>
      <style>body { color: red }</style>
      <iframe src="https://example.test"></iframe>
      <object data="https://example.test"></object>
      <embed src="https://example.test">
      <form><input value="x"><button>submit</button><select><option>one</option></select><textarea>text</textarea></form>
      <math><mi>x</mi></math>
      <canvas>draw</canvas>
      <audio src="x"></audio><video src="x"><source src="x"><track src="x"></video>
      <meta charset="utf-8"><link rel="stylesheet" href="x"><base href="https://example.test">
      <noscript>fallback</noscript><mx-reply>reply</mx-reply><img src="https://example.test/x.png" alt="x">
      <p>safe</p>
    `);

    expect(sanitized).toContain('<p>safe</p>');
    for (const forbidden of [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'select',
      'textarea',
      'option',
      'math',
      'canvas',
      'audio',
      'video',
      'source',
      'track',
      'meta',
      'link',
      'base',
      'noscript',
      'mx-reply',
      'img',
      '__mindroomExtrasXss',
    ]) {
      expect(sanitized).not.toContain(forbidden);
    }
  });

  it('strips event handlers, style attributes, data attributes, and unsafe code classes', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <p onclick="alert(1)" style="color:red" data-id="x">paragraph</p>
      <code class="language-ts unsafe" onload="alert(1)">code</code>
      <pre class="language-js other">pre</pre>
    `);

    expect(sanitized).toContain('<p>paragraph</p>');
    expect(sanitized).toContain('<code class="language-ts">code</code>');
    expect(sanitized).toContain('<pre class="language-js">pre</pre>');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('onload');
    expect(sanitized).not.toContain('style=');
    expect(sanitized).not.toContain('data-id');
    expect(sanitized).not.toContain('unsafe');
  });

  it('rejects unsafe, protocol-relative, relative, and malformed href values', () => {
    const scriptHref = `${'java'}script:alert(1)`;
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <a href="${scriptHref}">javascript</a>
      <a href="data:text/html,evil">data</a>
      <a href="vbscript:msgbox(1)">vbscript</a>
      <a href="file:///etc/passwd">file</a>
      <a href="blob:https://example.test/id">blob</a>
      <a href="//example.test/path">protocol-relative</a>
      <a href="/relative/path">relative</a>
      <a href="https://exa mple.test">malformed</a>
      <a href="http://example.test/safe">safe</a>
    `);

    expect(sanitized).toContain(
      '<a href="http://example.test/safe" target="_blank" rel="noreferrer noopener">safe</a>'
    );
    expect(sanitized).toContain('<a>javascript</a>');
    expect(sanitized).toContain('<a>protocol-relative</a>');
    expect(sanitized).not.toContain(scriptHref);
    expect(sanitized).not.toContain('data:');
    expect(sanitized).not.toContain('vbscript:');
    expect(sanitized).not.toContain('file:');
    expect(sanitized).not.toContain('blob:');
    expect(sanitized).not.toContain('href="//example.test');
    expect(sanitized).not.toContain('href="/relative/path');
    expect(sanitized).not.toContain('https://exa mple.test');
  });

  it('removes nested details, summary, and MindRoom semantic tags', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <details open><summary>sender summary</summary><p>sender details</p></details>
      <think>hidden thought</think>
      <debug>debug data</debug>
      <system>system prompt</system>
      <plan>plan text</plan>
      <analysis>analysis text</analysis>
      <research>research text</research>
      <p>visible</p>
    `);

    expect(sanitized).toContain('<p>visible</p>');
    for (const forbidden of [
      'details',
      'summary',
      'sender summary',
      'sender details',
      'think',
      'hidden thought',
      'debug',
      'system',
      'plan text',
      'analysis',
      'research',
    ]) {
      expect(sanitized).not.toContain(forbidden);
    }
  });

  it('handles malformed and deeply nested HTML without throwing', () => {
    const deepHtml = `${'<div>'.repeat(150)}deep${'</div>'.repeat(150)}`;

    expect(() => sanitizeMindroomMessageExtraHtml('<p><strong>broken')).not.toThrow();
    expect(() => sanitizeMindroomMessageExtraHtml(deepHtml)).not.toThrow();
    expect(sanitizeMindroomMessageExtraHtml('<p><strong>broken')).toContain(
      '<p><strong>broken</strong></p>'
    );
  });
});
