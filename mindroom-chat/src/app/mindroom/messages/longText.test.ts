import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMindroomLongTextPreview,
  clearMindroomLongTextHydrationCache,
  getMindroomLongTextSource,
  hasMindroomLongTextMetadata,
  hydrateMindroomLongTextSource,
  parseMindroomLongTextJsonSidecar,
} from './longText';
import { MINDROOM_MESSAGE_EXTRAS_KEY } from './messageExtrasData';

beforeEach(() => {
  clearMindroomLongTextHydrationCache();
});

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
};

describe('buildMindroomLongTextPreview', () => {
  it('previews the start of the text and keeps the routing', () => {
    const relation = { rel_type: 'm.thread', event_id: '$thread' };
    const mentions = { user_ids: ['@mindroom_writer:example.org'] };

    const preview = buildMindroomLongTextPreview({
      msgtype: 'm.text',
      body: 'x'.repeat(50_000),
      format: 'org.matrix.custom.html',
      formatted_body: '<p>x</p>',
      'm.mentions': mentions,
      'm.relates_to': relation,
    });

    expect(preview).toEqual({
      body: `${'x'.repeat(2000)}\n\n[Message continues in attached file]`,
      'm.mentions': mentions,
      'm.relates_to': relation,
    });
  });

  it('cuts the preview between characters', () => {
    // An emoji is two UTF-16 units; the 2000-unit cut would split the last one in half.
    const preview = buildMindroomLongTextPreview({ body: `${'x'.repeat(1999)}${'😀'.repeat(10)}` });

    expect(preview.body).toBe(`${'x'.repeat(1999)}\n\n[Message continues in attached file]`);
    expect(Object.keys(preview)).toEqual(['body']);
  });
});

describe('getMindroomLongTextSource', () => {
  it('ignores regular file events without long_text metadata', () => {
    const source = getMindroomLongTextSource({
      msgtype: 'm.file',
      url: 'mxc://server/not-long-text',
      body: 'attachment.pdf',
    });

    expect(source).toBeUndefined();
  });

  it('detects v2 unencrypted sidecar source from content.url', () => {
    const source = getMindroomLongTextSource({
      msgtype: 'm.file',
      url: 'mxc://server/id',
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    });

    expect(source?.mxcUri).toBe('mxc://server/id');
    expect(source?.isV2ContentJson).toBe(true);
    expect(source?.encryptedFile).toBeUndefined();
  });

  it('detects v2 encrypted sidecar source from content.file.url', () => {
    const source = getMindroomLongTextSource({
      msgtype: 'm.file',
      file: {
        url: 'mxc://server/encrypted',
        key: { kty: 'oct', k: 'abc', alg: 'A256CTR', key_ops: ['encrypt', 'decrypt'] },
        iv: 'iv',
        hashes: { sha256: 'hash' },
        v: 'v2',
      },
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    });

    expect(source?.mxcUri).toBe('mxc://server/encrypted');
    expect(source?.isV2ContentJson).toBe(true);
    expect(source?.encryptedFile?.url).toBe('mxc://server/encrypted');
  });

  it('uses m.new_content when raw edit wrapper is provided', () => {
    const source = getMindroomLongTextSource({
      'm.new_content': {
        msgtype: 'm.file',
        url: 'mxc://server/new-content',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    expect(source?.mxcUri).toBe('mxc://server/new-content');
    expect(source?.previewContent.body).toBeUndefined();
    expect(source?.previewContent.msgtype).toBe('m.file');
  });

  it('copies wrapper tool trace fallback into m.new_content long-text previews', () => {
    const toolTrace = {
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
    };
    const source = getMindroomLongTextSource({
      'io.mindroom.tool_trace': toolTrace,
      'm.new_content': {
        body: 'Preview\n\n🔧 `run_shell_command` [1]',
        formatted_body: '<p>Preview</p><p>🔧 <code>run_shell_command</code> [1]</p>',
        msgtype: 'm.text',
        url: 'mxc://server/streaming-sidecar',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    expect(source?.previewContent['io.mindroom.tool_trace']).toBe(toolTrace);
  });
});

describe('hasMindroomLongTextMetadata', () => {
  it('detects long-text metadata without requiring a resolvable sidecar source', () => {
    expect(
      hasMindroomLongTextMetadata({
        msgtype: 'm.text',
        body: 'placeholder',
        'io.mindroom.long_text': {
          version: 2,
        },
      })
    ).toBe(true);
  });

  it('detects metadata in raw edit wrappers', () => {
    expect(
      hasMindroomLongTextMetadata({
        'm.new_content': {
          msgtype: 'm.text',
          body: 'placeholder',
          'io.mindroom.long_text': {
            version: 2,
          },
        },
      })
    ).toBe(true);
  });

  it('ignores regular message content', () => {
    expect(
      hasMindroomLongTextMetadata({
        msgtype: 'm.text',
        body: 'normal',
      })
    ).toBe(false);
  });
});

describe('parseMindroomLongTextJsonSidecar', () => {
  it('parses sidecar json into content object', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        msgtype: 'm.text',
        body: 'hello',
      })
    );

    expect(parsed).toEqual({
      msgtype: 'm.text',
      body: 'hello',
    });
  });

  it('extracts message content from event envelope payloads', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        type: 'm.room.message',
        sender: '@bot:example.com',
        content: {
          msgtype: 'm.text',
          body: 'hello from event envelope',
        },
      })
    );

    expect(parsed).toEqual({
      msgtype: 'm.text',
      body: 'hello from event envelope',
    });
  });

  it('extracts the latest replacement content from debug snapshot payloads', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        '<== MAIN_EVENT ==>': {
          content: {
            msgtype: 'm.text',
            body: 'thinking...',
          },
        },
        '<== REPLACEMENT_EVENT_1 ==>': {
          content: {
            msgtype: 'm.text',
            body: 'partial',
          },
        },
        '<== REPLACEMENT_EVENT_2 ==>': {
          content: {
            msgtype: 'm.text',
            body: 'final',
            formatted_body: '<p>final</p>',
          },
        },
      })
    );

    expect(parsed).toEqual({
      msgtype: 'm.text',
      body: 'final',
      formatted_body: '<p>final</p>',
    });
  });

  it('returns undefined for sidecar json without message content', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        random: { payload: true },
      })
    );

    expect(parsed).toBeUndefined();
  });

  it('returns undefined for invalid sidecar json', () => {
    expect(parseMindroomLongTextJsonSidecar('{not-json')).toBeUndefined();
  });
});

describe('hydrateMindroomLongTextSource', () => {
  it('hydrates v2 sidecar json and keeps tool-trace metadata', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        formatted_body: '<p>preview</p>',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: 'Full response',
          formatted_body: '<p>🔧 <code>tool_name</code> [1]</p>',
          'io.mindroom.ai_run': {
            version: 1,
            status: 'completed',
            usage: { total_tokens: 125 },
          },
          'io.mindroom.tool_trace': {
            version: 2,
            events: [{ type: 'tool_call_completed', tool_name: 'tool_name' }],
          },
        }),
      {}
    );

    expect(resolved.body).toBe('Full response');
    expect(resolved.formatted_body).toBe('<p>🔧 <code>tool_name</code> [1]</p>');
    expect(resolved['io.mindroom.tool_trace']).toEqual({
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'tool_name' }],
    });
    expect(resolved['io.mindroom.ai_run']).toEqual({
      version: 1,
      status: 'completed',
      usage: { total_tokens: 125 },
    });
  });

  it('hydrates v2 edit wrapper payloads by rendering from m.new_content', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: '* fallback edit body',
          'io.mindroom.ai_run': {
            version: 1,
            status: 'cached',
            usage: { total_tokens: 42 },
          },
          'm.new_content': {
            msgtype: 'm.text',
            body: 'final edited body',
            formatted_body: '<p>🔧 <code>search_web</code> [1]</p>',
          },
          'io.mindroom.tool_trace': {
            version: 2,
            events: [{ type: 'tool_call_completed', tool_name: 'search_web' }],
          },
        }),
      {}
    );

    expect(resolved.body).toBe('final edited body');
    expect(resolved.formatted_body).toBe('<p>🔧 <code>search_web</code> [1]</p>');
    expect(resolved.msgtype).toBe('m.text');
    expect(resolved['io.mindroom.tool_trace']).toEqual({
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'search_web' }],
    });
    expect(resolved['io.mindroom.ai_run']).toEqual({
      version: 1,
      status: 'cached',
      usage: { total_tokens: 42 },
    });
  });

  it('preserves wrapper MindRoom extras when hydrated m.new_content omits them', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper-extras',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const extras = {
      version: 1,
      sections: [
        {
          title: 'Hydrated evidence',
          content_type: 'text/plain',
          content: 'wrapper sidecar extra',
        },
      ],
    };

    const resolved = await hydrateMindroomLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: '* fallback edit body',
          [MINDROOM_MESSAGE_EXTRAS_KEY]: extras,
          'm.new_content': {
            msgtype: 'm.text',
            body: 'final edited body',
            formatted_body: '<p>final edited body</p>',
          },
        }),
      {}
    );

    expect(resolved.body).toBe('final edited body');
    expect(resolved.formatted_body).toBe('<p>final edited body</p>');
    expect(resolved[MINDROOM_MESSAGE_EXTRAS_KEY]).toEqual(extras);
  });

  it('falls back to wrapper body when m.new_content body is missing', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper-fallback',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: '* wrapper body',
          'm.new_content': {
            msgtype: 'm.text',
            formatted_body: '<p>formatted only</p>',
          },
        }),
      {}
    );

    expect(resolved.body).toBe('* wrapper body');
    expect(resolved.formatted_body).toBe('<p>formatted only</p>');
  });

  it('falls back to preview content when sidecar fetch fails', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(
      source,
      async () => {
        throw new Error('download failed');
      },
      {}
    );

    expect(resolved).toBe(source.previewContent);
    expect(resolved.body).toBe('preview body');
  });

  it('falls back to preview content when v2 sidecar json parsing fails', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(source, async () => '{bad-json', {});

    expect(resolved).toBe(source.previewContent);
    expect(resolved.body).toBe('preview body');
  });

  it('uses cache for repeated hydration of the same mxc uri', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/cached',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const loadSidecarText = vi.fn(async () =>
      JSON.stringify({
        msgtype: 'm.text',
        body: 'cached full body',
      })
    );

    const cacheOwner = {};
    const first = await hydrateMindroomLongTextSource(source, loadSidecarText, cacheOwner);
    const second = await hydrateMindroomLongTextSource(source, loadSidecarText, cacheOwner);

    expect(loadSidecarText).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('does not share hydrated plaintext between account clients', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/shared-id',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const accountA = {};
    const accountB = {};
    const loadForAccountA = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'account A plaintext' })
    );
    const loadForAccountB = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'account B plaintext' })
    );

    const first = await hydrateMindroomLongTextSource(source, loadForAccountA, accountA);
    const second = await hydrateMindroomLongTextSource(source, loadForAccountB, accountB);

    expect(first.body).toBe('account A plaintext');
    expect(second.body).toBe('account B plaintext');
    expect(loadForAccountA).toHaveBeenCalledTimes(1);
    expect(loadForAccountB).toHaveBeenCalledTimes(1);
  });

  it('does not share plaintext across different encryption descriptors for one MXC URI', async () => {
    const makeEncryptedSource = (key: string) =>
      expectDefined(
        getMindroomLongTextSource({
          msgtype: 'm.file',
          body: 'preview body',
          file: {
            url: 'mxc://server/shared-encrypted-id',
            key: { kty: 'oct', k: key, alg: 'A256CTR', key_ops: ['decrypt'] },
            iv: 'iv',
            hashes: { sha256: `hash-${key}` },
            v: 'v2',
          },
          'io.mindroom.long_text': {
            version: 2,
            encoding: 'matrix_event_content_json',
          },
        })
      );
    const cacheOwner = {};
    const firstLoader = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'first descriptor plaintext' })
    );
    const secondLoader = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'second descriptor plaintext' })
    );

    const first = await hydrateMindroomLongTextSource(
      makeEncryptedSource('key-a'),
      firstLoader,
      cacheOwner
    );
    const second = await hydrateMindroomLongTextSource(
      makeEncryptedSource('key-b'),
      secondLoader,
      cacheOwner
    );

    expect(first.body).toBe('first descriptor plaintext');
    expect(second.body).toBe('second descriptor plaintext');
    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(secondLoader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent downloads of the same sidecar into one fetch', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/coalesce',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const cacheOwner = {};
    let releaseLoader!: (value: string) => void;
    const loader = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseLoader = resolve;
        })
    );

    // The prewarm pool and a mounting row race the same source: one fetch.
    const first = hydrateMindroomLongTextSource(source, loader, cacheOwner);
    const second = hydrateMindroomLongTextSource(source, loader, cacheOwner);
    // The loader is deferred one microtask past in-flight registration.
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    releaseLoader(JSON.stringify({ msgtype: 'm.text', body: 'Full response' }));
    const [firstResolved, secondResolved] = await Promise.all([first, second]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(firstResolved.body).toBe('Full response');
    expect(secondResolved).toBe(firstResolved);
  });

  it('retries after a failed download instead of pinning the failure in flight', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/retry',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const cacheOwner = {};
    const loader = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(JSON.stringify({ msgtype: 'm.text', body: 'Recovered' }));

    const failed = await hydrateMindroomLongTextSource(source, loader, cacheOwner);
    expect(failed).toBe(source.previewContent);

    const recovered = await hydrateMindroomLongTextSource(source, loader, cacheOwner);
    expect(recovered.body).toBe('Recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('retries after a SYNCHRONOUS loader throw instead of pinning the entry in flight', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/sync-throw',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const cacheOwner = {};
    // A sync throw settles the async body before its first await; the
    // in-flight entry must be registered before the loader can run, or the
    // finally-cleanup fires before registration and a resolved preview
    // promise stays in the map forever.
    const loader = vi
      .fn<[], Promise<string>>()
      .mockImplementationOnce(() => {
        throw new Error('sync failure');
      })
      .mockResolvedValueOnce(JSON.stringify({ msgtype: 'm.text', body: 'Recovered' }));

    const failed = await hydrateMindroomLongTextSource(source, loader, cacheOwner);
    expect(failed).toBe(source.previewContent);

    const recovered = await hydrateMindroomLongTextSource(source, loader, cacheOwner);
    expect(recovered.body).toBe('Recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
