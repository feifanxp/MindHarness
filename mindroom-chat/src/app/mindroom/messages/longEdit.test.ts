import type { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { contentBytes, getMindroomLongTextSource, hydrateMindroomLongTextSource } from './longText';
import { buildMindroomEditContent, loadMindroomEditableContent } from './longEdit';

const relation = { rel_type: 'm.replace', event_id: '$original' };
const mentions = { user_ids: ['@mindroom_writer:example.org'] };
const longContent = {
  msgtype: 'm.text',
  body: 'word '.repeat(10_000).trim(),
  format: 'org.matrix.custom.html',
  formatted_body: `<ul>${'<li><strong>word</strong></li>'.repeat(2_000)}</ul>`,
  'm.mentions': mentions,
};
const longTextFile = {
  msgtype: 'm.file',
  body: 'word word\n\n[Message continues in attached file]',
  url: 'mxc://example.org/earlier',
  'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
};

const setup = () => {
  const mx = {
    uploadContent: vi.fn(async (_file: Blob) => ({ content_uri: 'mxc://example.org/sidecar' })),
  };
  const room = { hasEncryptionStateEvent: () => false } as unknown as Room;
  return { mx, client: mx as unknown as MatrixClient, room };
};

describe('buildMindroomEditContent', () => {
  it('sends an edit that fits one event as it is', async () => {
    const { mx, client, room } = setup();
    const newContent = { msgtype: 'm.text', body: 'fixed', 'm.mentions': {} };

    const edit = await buildMindroomEditContent(client, room, newContent, relation);

    expect(edit).toEqual({
      ...newContent,
      body: '* fixed',
      'm.new_content': newContent,
      'm.relates_to': relation,
    });
    expect(mx.uploadContent).not.toHaveBeenCalled();
  });

  it('sends a large edit as a long-text sidecar', async () => {
    const { mx, client, room } = setup();

    const edit = await buildMindroomEditContent(client, room, longContent, relation);

    // The file holds the whole edit, as MindRoom uploads its own: MindRoom reads the file in place
    // of the event and takes the edited message from its `m.new_content`.
    const uploaded = await (mx.uploadContent.mock.calls[0][0] as Blob).text();
    expect(JSON.parse(uploaded)).toEqual({
      ...longContent,
      body: `* ${longContent.body}`,
      'm.new_content': longContent,
      'm.relates_to': relation,
    });
    const replacement = edit['m.new_content'] as Record<string, unknown>;
    // Chat reads the edited message out of that file too.
    const source = getMindroomLongTextSource(replacement)!;
    expect(await hydrateMindroomLongTextSource(source, async () => uploaded, {})).toEqual(
      longContent
    );
    expect(replacement).toMatchObject({
      msgtype: 'm.file',
      url: 'mxc://example.org/sidecar',
      'm.mentions': mentions,
      'io.mindroom.long_text': { version: 2 },
    });
    expect(replacement['m.relates_to']).toBeUndefined();
    expect(edit).toMatchObject({
      msgtype: 'm.text',
      'm.mentions': mentions,
      'm.relates_to': relation,
    });
    expect(edit.body).toBe(`* ${replacement.body}`);
    expect(edit.url).toBeUndefined();
    expect(contentBytes(edit)).toBeLessThan(10_000);
  });
});

describe('loadMindroomEditableContent', () => {
  it('returns text content as it is', async () => {
    const hydrate = vi.fn();
    const content = { msgtype: 'm.text', body: 'short' };

    expect(await loadMindroomEditableContent(content, hydrate)).toBe(content);
    expect(hydrate).not.toHaveBeenCalled();
  });

  it('returns the whole content of a long-text message', async () => {
    const hydrate = vi.fn(async () => longContent);

    expect(await loadMindroomEditableContent(longTextFile, hydrate)).toBe(longContent);
    expect(hydrate.mock.calls[0][0]).toMatchObject({ mxcUri: 'mxc://example.org/earlier' });
  });

  it('returns nothing when the whole content cannot be loaded', async () => {
    // Hydration falls back to the preview, which must never be edited in place of the message.
    const hydrate = vi.fn(
      async (source: NonNullable<ReturnType<typeof getMindroomLongTextSource>>) =>
        source.previewContent
    );

    expect(await loadMindroomEditableContent(longTextFile, hydrate)).toBeUndefined();
  });
});
