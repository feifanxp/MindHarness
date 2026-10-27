import { describe, expect, it } from 'vitest';
import { sanitizeCustomHtml } from '../../utils/sanitize';
import { mindroomCustomHtmlSanitizerPolicy } from './customHtmlPolicy';

describe('mindroomCustomHtmlSanitizerPolicy', () => {
  it('keeps paste markers and Matrix math attributes needed by MindRoom rendering', () => {
    expect(mindroomCustomHtmlSanitizerPolicy.allowedAttributes?.span).toEqual(
      expect.arrayContaining([
        'data-mx-maths',
        'data-mindroom-paste-marker',
        'data-mindroom-paste-id',
        'data-mindroom-paste-chars',
        'data-mindroom-paste-file',
      ])
    );
    expect(mindroomCustomHtmlSanitizerPolicy.allowedAttributes?.div).toContain('data-mx-maths');

    const sanitized = sanitizeCustomHtml(
      [
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c"',
        ' data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste id=paste-a3f19c chars=11 file="mindroom-paste-a3f19c.txt"]]',
        '</span>',
        '<span data-mx-maths="x^2">x^2</span>',
        '<div data-mx-maths="\\frac{a}{b}">\\frac{a}{b}</div>',
      ].join('')
    );

    expect(sanitized).toContain('data-mindroom-paste-marker="true"');
    expect(sanitized).toContain('data-mindroom-paste-id="paste-a3f19c"');
    expect(sanitized).toContain('data-mx-maths="x^2"');
    expect(sanitized).toContain('data-mx-maths="\\frac{a}{b}"');
  });

  it('keeps the sanitizer strict around MindRoom policy additions', () => {
    const unsafeUrlScheme = ['java', 'script:'].join('');
    const sanitized = sanitizeCustomHtml(`
      <span data-mindroom-paste-marker="true" data-unsafe="x" onclick="alert(1)" style="position:absolute;color:#123">
        marker
      </span>
      <think onclick="alert(1)"><script>alert(1)</script>safe thought</think>
      <span data-mx-maths="x" style="background-image:url(${unsafeUrlScheme}alert(1));color:red">x</span>
    `);

    expect(sanitized).toContain('data-mindroom-paste-marker="true"');
    expect(sanitized).toContain('<think>safe thought</think>');
    expect(sanitized).toContain('data-mx-maths="x"');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('data-unsafe');
    expect(sanitized).not.toContain('position:absolute');
    expect(sanitized).not.toContain('background-image');
    expect(sanitized).not.toContain(unsafeUrlScheme);
    expect(sanitized).not.toContain('<script>');
  });

  it('adds custom style rules without replacing base style rules', () => {
    const sanitized = sanitizeCustomHtml(
      [
        '<p style="color:#123">hex</p>',
        '<p style="color:red">named</p>',
        '<p style="color:blue">blocked</p>',
      ].join(''),
      {
        policy: {
          allowedAttributes: {
            p: ['style'],
          },
          allowedStyles: {
            '*': {
              color: [/^red$/],
            },
          },
        },
      }
    );

    expect(sanitized).toContain('<p style="color:#123">hex</p>');
    expect(sanitized).toContain('<p style="color:red">named</p>');
    expect(sanitized).toContain('<p>blocked</p>');
  });

  it('does not let custom policy replace base security transformers', () => {
    const sanitized = sanitizeCustomHtml('<a href="https://example.com" target="_self">link</a>', {
      policy: {
        transformTags: {
          a: (tagName, attribs) => ({
            tagName,
            attribs: {
              ...attribs,
              rel: 'unsafe',
              target: '_self',
            },
          }),
        },
      },
    });

    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('rel="noreferrer noopener"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).not.toContain('rel="unsafe"');
    expect(sanitized).not.toContain('target="_self"');
  });

  it('allows configured application URI schemes without allowing dangerous browser schemes', () => {
    const scriptHref = `${'java'}script:alert(1)`;
    const sanitized = sanitizeCustomHtml(
      [
        '<a href="obsidian://open?vault=notes&amp;file=daily">note</a>',
        `<a href="${scriptHref}">script</a>`,
        '<a href="data:text/html,evil">data</a>',
        '<a href="file:///etc/passwd">file</a>',
      ].join(''),
      {
        additionalAllowedUriSchemes: ['Obsidian://', 'javascript', 'data', 'file', 'not a scheme'],
      }
    );

    expect(sanitized).toContain('href="obsidian://open?vault=notes&amp;file=daily"');
    expect(sanitized).not.toContain(scriptHref);
    expect(sanitized).not.toContain('data:text/html');
    expect(sanitized).not.toContain('file:///etc/passwd');
  });

  it('ignores malformed custom URI scheme configuration without breaking message rendering', () => {
    const link = '<a href="obsidian://open?vault=notes&amp;file=daily">note</a>';

    expect(() =>
      sanitizeCustomHtml(link, {
        additionalAllowedUriSchemes: 'obsidian',
      })
    ).not.toThrow();
    expect(
      sanitizeCustomHtml(link, {
        additionalAllowedUriSchemes: 'obsidian',
      })
    ).not.toContain('href=');

    const sanitized = sanitizeCustomHtml(link, {
      additionalAllowedUriSchemes: ['obsidian', null, 42, {}],
    });
    expect(sanitized).toContain('href="obsidian://open?vault=notes&amp;file=daily"');
  });
});
