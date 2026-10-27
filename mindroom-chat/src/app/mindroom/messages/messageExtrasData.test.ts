import { describe, expect, it } from 'vitest';
import {
  MINDROOM_MESSAGE_EXTRAS_KEY,
  MINDROOM_MESSAGE_EXTRAS_MAX_CONTENT_CHARS,
  MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS,
  MINDROOM_MESSAGE_EXTRAS_MAX_TITLE_CHARS,
  hasMindroomMessageExtras,
  parseMindroomMessageExtras,
} from './messageExtrasData';

const createContent = (sections: unknown[], overrides: Record<string, unknown> = {}) => ({
  [MINDROOM_MESSAGE_EXTRAS_KEY]: {
    version: 1,
    sections,
    ...overrides,
  },
});

const validSection = (overrides: Record<string, unknown> = {}) => ({
  title: 'Details',
  content_type: 'text/plain',
  content: 'payload',
  ...overrides,
});

describe('parseMindroomMessageExtras', () => {
  it('returns null when the custom key is missing', () => {
    expect(parseMindroomMessageExtras({ body: 'Hello' })).toBeNull();
  });

  it('returns null for a non-object extras value', () => {
    expect(parseMindroomMessageExtras({ [MINDROOM_MESSAGE_EXTRAS_KEY]: 'bad' })).toBeNull();
  });

  it('returns null for unsupported versions', () => {
    expect(parseMindroomMessageExtras(createContent([validSection()], { version: 0 }))).toBeNull();
    expect(parseMindroomMessageExtras(createContent([validSection()], { version: 3 }))).toBeNull();
  });

  it('returns null when sections is not an array', () => {
    expect(parseMindroomMessageExtras(createContent([], { sections: {} }))).toBeNull();
  });

  it('normalizes a valid schema', () => {
    expect(
      parseMindroomMessageExtras(
        createContent([
          validSection({
            title: '  Evidence  ',
            content_type: 'text/markdown',
            content: '**bold**',
            collapsed: false,
            extra: 'ignored',
          }),
        ])
      )
    ).toEqual({
      version: 1,
      sections: [
        {
          title: 'Evidence',
          contentType: 'text/markdown',
          content: '**bold**',
          collapsed: false,
        },
      ],
    });
  });

  it('keeps v1 plain and markdown normalization unchanged', () => {
    expect(
      parseMindroomMessageExtras(
        createContent([
          validSection({
            title: 'Plain',
            content_type: 'text/plain',
            content: '<strong>literal</strong>',
          }),
          validSection({
            title: 'Markdown',
            content_type: 'text/markdown',
            content: '**bold**',
            collapsed: false,
          }),
        ])
      )
    ).toEqual({
      version: 1,
      sections: [
        {
          title: 'Plain',
          contentType: 'text/plain',
          content: '<strong>literal</strong>',
          collapsed: true,
        },
        {
          title: 'Markdown',
          contentType: 'text/markdown',
          content: '**bold**',
          collapsed: false,
        },
      ],
    });
  });

  it('defaults collapsed to true', () => {
    const extras = parseMindroomMessageExtras(createContent([validSection()]));

    expect(extras?.sections[0].collapsed).toBe(true);
  });

  it('keeps explicit collapsed false open', () => {
    const extras = parseMindroomMessageExtras(createContent([validSection({ collapsed: false })]));

    expect(extras?.sections[0].collapsed).toBe(false);
  });

  it('skips invalid sections while keeping valid sections', () => {
    const extras = parseMindroomMessageExtras(
      createContent([
        null,
        validSection({ title: '   ' }),
        validSection({ content: 42 }),
        validSection({ title: 'Kept', content: 'ok' }),
      ])
    );

    expect(extras?.sections).toHaveLength(1);
    expect(extras?.sections[0].title).toBe('Kept');
  });

  it('skips text/html in v1', () => {
    expect(
      parseMindroomMessageExtras(createContent([validSection({ content_type: 'text/html' })]))
    ).toBeNull();
  });

  it('skips v1 text/html while keeping valid v1 sections', () => {
    const extras = parseMindroomMessageExtras(
      createContent([
        validSection({ title: 'HTML', content_type: 'text/html', content: '<p>skip</p>' }),
        validSection({ title: 'Plain', content_type: 'text/plain', content: 'keep' }),
      ])
    );

    expect(extras).toEqual({
      version: 1,
      sections: [
        {
          title: 'Plain',
          contentType: 'text/plain',
          content: 'keep',
          collapsed: true,
        },
      ],
    });
  });

  it('accepts v2 plain, markdown, and html sections', () => {
    expect(
      parseMindroomMessageExtras(
        createContent(
          [
            validSection({ title: 'Plain', content_type: 'text/plain', content: 'plain' }),
            validSection({ title: 'Markdown', content_type: 'text/markdown', content: '**md**' }),
            validSection({ title: 'HTML', content_type: 'text/html', content: '<p>html</p>' }),
          ],
          { version: 2 }
        )
      )
    ).toEqual({
      version: 2,
      sections: [
        {
          title: 'Plain',
          contentType: 'text/plain',
          content: 'plain',
          collapsed: true,
        },
        {
          title: 'Markdown',
          contentType: 'text/markdown',
          content: '**md**',
          collapsed: true,
        },
        {
          title: 'HTML',
          contentType: 'text/html',
          content: '<p>html</p>',
          collapsed: true,
        },
      ],
    });
  });

  it('skips unknown v2 content types while preserving valid sections', () => {
    const extras = parseMindroomMessageExtras(
      createContent(
        [
          validSection({ title: 'Unsupported', content_type: 'application/json' }),
          validSection({ title: 'HTML', content_type: 'text/html', content: '<p>ok</p>' }),
        ],
        { version: 2 }
      )
    );

    expect(extras?.sections).toEqual([
      {
        title: 'HTML',
        contentType: 'text/html',
        content: '<p>ok</p>',
        collapsed: true,
      },
    ]);
  });

  it('returns null for v2 envelopes when all sections are invalid', () => {
    expect(
      parseMindroomMessageExtras(
        createContent([validSection({ content_type: 'application/json' })], { version: 2 })
      )
    ).toBeNull();
  });

  it('reports only valid envelopes as collapsible extras metadata', () => {
    expect(
      hasMindroomMessageExtras(
        createContent([validSection({ content_type: 'text/html', content: '<p>ok</p>' })], {
          version: 2,
        })
      )
    ).toBe(true);
    expect(
      hasMindroomMessageExtras(
        createContent([validSection({ content_type: 'text/html', content: '<p>skip</p>' })])
      )
    ).toBe(false);
  });

  it('skips oversized content', () => {
    expect(
      parseMindroomMessageExtras(
        createContent([
          validSection({ content: 'x'.repeat(MINDROOM_MESSAGE_EXTRAS_MAX_CONTENT_CHARS + 1) }),
        ])
      )
    ).toBeNull();
  });

  it('caps section count at the first configured candidates', () => {
    const extras = parseMindroomMessageExtras(
      createContent(
        Array.from({ length: MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS + 1 }, (_, index) =>
          validSection({ title: `Section ${index + 1}` })
        )
      )
    );

    expect(extras?.sections).toHaveLength(MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS);
    expect(extras?.sections.at(-1)?.title).toBe(`Section ${MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS}`);
  });

  it('trims and clamps titles', () => {
    const title = ` ${'a'.repeat(MINDROOM_MESSAGE_EXTRAS_MAX_TITLE_CHARS + 10)} `;
    const extras = parseMindroomMessageExtras(createContent([validSection({ title })]));

    expect(extras?.sections[0].title).toBe('a'.repeat(MINDROOM_MESSAGE_EXTRAS_MAX_TITLE_CHARS));
  });

  it('never throws when given unexpected content', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => parseMindroomMessageExtras(circular)).not.toThrow();
    expect(parseMindroomMessageExtras(circular)).toBeNull();
  });
});
