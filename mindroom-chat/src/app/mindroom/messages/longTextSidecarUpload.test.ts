import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptFile } from '../../utils/matrix';
import {
  getMindroomLongTextSidecarFacts,
  getMindroomLongTextSource,
  parseMindroomLongTextJsonSidecar,
} from './longText';
import { uploadMindroomLongTextSidecar } from './longTextSidecarUpload';

const content = {
  msgtype: 'm.text',
  body: '@mindroom_writer:example.org Here is the whole draft\n{"text":"…"}',
  'm.mentions': { user_ids: ['@mindroom_writer:example.org'] },
  'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
  'io.mindroom.example': { data: 'x'.repeat(70_000) },
};
const preview = {
  body: '@mindroom_writer:example.org Here is the whole draft',
  'm.mentions': content['m.mentions'],
  'm.relates_to': content['m.relates_to'],
};

const setup = ({
  encrypted = false,
  uploadError,
}: { encrypted?: boolean; uploadError?: Error } = {}) => {
  const uploads: Blob[] = [];
  const mx = {
    uploadContent: vi.fn(async (file: Blob) => {
      uploads.push(file);
      if (uploadError) throw uploadError;
      return { content_uri: 'mxc://example.org/sidecar' };
    }),
  } as unknown as MatrixClient;
  const room = { hasEncryptionStateEvent: () => encrypted } as unknown as Room;
  return { mx, room, uploads };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadMindroomLongTextSidecar', () => {
  it('uploads the whole content and returns the preview MindRoom reads as a long-text sidecar', async () => {
    const { mx, room, uploads } = setup();

    const event = await uploadMindroomLongTextSidecar(mx, room, content, preview);

    // The shape MindRoom's backend accepts (sidecar_content.sidecar_mxc_url).
    expect(event).toMatchObject({
      msgtype: 'm.file',
      body: preview.body,
      filename: 'message-content.json',
      url: 'mxc://example.org/sidecar',
      info: { mimetype: 'application/json' },
      'm.mentions': preview['m.mentions'],
      'm.relates_to': preview['m.relates_to'],
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
        preview_size: preview.body.length,
        is_complete_content: true,
      },
    });
    expect(event.file).toBeUndefined();
    // Chat's own reader finds the file and parses back exactly the content that was sent.
    expect(getMindroomLongTextSource(event)?.mxcUri).toBe('mxc://example.org/sidecar');
    const uploaded = await uploads[0].text();
    const parsed = parseMindroomLongTextJsonSidecar(uploaded)!;
    expect(parsed).toEqual(content);
    // The file is the content itself, the shape MindRoom reads, and its size is recorded.
    expect(getMindroomLongTextSidecarFacts(parsed)).toEqual({
      topLevelContent: true,
      bytes: new TextEncoder().encode(uploaded).length,
    });
    expect(Object.keys(parsed)).not.toContain('topLevelContent');
  });

  it('records when Chat read a file shape MindRoom does not read', () => {
    const nested = parseMindroomLongTextJsonSidecar(JSON.stringify({ content }))!;
    expect(nested).toEqual(content);
    expect(getMindroomLongTextSidecarFacts(nested)?.topLevelContent).toBe(false);
  });

  it('uploads ciphertext in an encrypted room and references it with its key', async () => {
    // The attachment encryption reads WebCrypto from window; Node provides it on globalThis.
    vi.stubGlobal('window', globalThis);
    const { mx, room, uploads } = setup({ encrypted: true });

    const event = await uploadMindroomLongTextSidecar(mx, room, content, preview);

    expect(event.url).toBeUndefined();
    const file = event.file as Record<string, unknown>;
    expect(file).toMatchObject({ url: 'mxc://example.org/sidecar', v: 'v2' });
    expect(getMindroomLongTextSource(event)?.encryptedFile).toEqual(file);
    const ciphertext = await uploads[0].arrayBuffer();
    expect(new TextDecoder().decode(ciphertext)).not.toContain('Here is the whole draft');
    const plaintext = await decryptFile(ciphertext, 'application/json', file as never);
    expect(parseMindroomLongTextJsonSidecar(await plaintext.text())).toEqual(content);
  });

  it('fails when the upload fails', async () => {
    const { mx, room } = setup({ uploadError: new Error('offline') });

    await expect(uploadMindroomLongTextSidecar(mx, room, content, preview)).rejects.toBeTruthy();
  });
});
