import { describe, expect, it } from 'vitest';
import { MAX_EVENT_CONTENT_BYTES } from '../messages/longText';
import {
  buildCanvasErrorContent,
  buildCanvasResponseContent,
  buildCanvasResponsePreview,
  canvasResponseFitsInEvent,
  CANVAS_RESPONSE_KEY,
  readCanvasError,
  readCanvasResponse,
  readCanvasState,
  readCanvasSubmission,
} from './canvasMessages';

const frame = {} as Window;
const message = (data: unknown, overrides: Partial<MessageEvent> = {}) =>
  ({ data, origin: 'null', source: frame, ...overrides } as MessageEvent);
const submit = (extra: Record<string, unknown> = {}) => ({
  type: 'mindroom.canvas.submit',
  version: 1,
  data: { plan: 'pro' },
  ...extra,
});

describe('readCanvasSubmission', () => {
  it('accepts a submission from the canvas frame', () => {
    expect(readCanvasSubmission(message(submit({ label: ' Pro plan ' })), frame)).toEqual({
      data: { plan: 'pro' },
      label: 'Pro plan',
    });
  });

  it.each([
    ['another window', message(submit(), { source: {} as Window })],
    ['a real origin', message(submit(), { origin: 'https://evil.example' })],
    ['an unknown type', message(submit({ type: 'other' }))],
    ['an unknown version', message(submit({ version: 2 }))],
    ['missing data', message(submit({ data: undefined }))],
    ['a function payload', message(submit({ data: () => 1 }))],
    ['a non-string label', message(submit({ label: 5 }))],
  ])('rejects %s', (_name, event) => {
    expect(readCanvasSubmission(event, frame)).toBeUndefined();
  });

  it('rejects payloads that cannot be serialized or are too large', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(readCanvasSubmission(message(submit({ data: cyclic })), frame)).toBeUndefined();
    // A long piece of text fits; the cap is 512 KiB of JSON.
    expect(
      readCanvasSubmission(message(submit({ data: 'x'.repeat(500 * 1024) })), frame)
    ).toBeDefined();
    expect(
      readCanvasSubmission(message(submit({ data: 'x'.repeat(512 * 1024) })), frame)
    ).toBeUndefined();
  });

  it('refuses text with a lone surrogate, which MindRoom cannot read back from a file', () => {
    expect(readCanvasSubmission(message(submit({ data: { doc: 'abc\ud83d' } })), frame)).toBe(
      undefined
    );
    expect(readCanvasSubmission(message(submit({ data: { '\udc00': 1 } })), frame)).toBe(undefined);
    expect(readCanvasSubmission(message(submit({ label: 'x\ud800' })), frame)).toBeUndefined();
    expect(
      readCanvasSubmission(message(submit({ data: { doc: 'Waves \ud83c\udf0a' } })), frame)?.data
    ).toEqual({ doc: 'Waves \ud83c\udf0a' });
  });

  it('sends decimal and unsafe numbers as text, which every homeserver accepts', () => {
    expect(
      readCanvasSubmission(
        message(submit({ data: { price: 12.5, seats: 3, big: 2 ** 60, list: [0.5, 1] } })),
        frame
      )?.data
    ).toEqual({ big: String(2 ** 60), list: ['0.5', 1], price: '12.5', seats: 3 });
  });

  it('shortens long labels and drops empty ones', () => {
    expect(
      readCanvasSubmission(message(submit({ label: 'a'.repeat(300) })), frame)?.label
    ).toHaveLength(200);
    // The cut falls inside an emoji; half of one is not text, so the whole emoji goes.
    expect(
      readCanvasSubmission(message(submit({ label: `${'a'.repeat(199)}😀` })), frame)?.label
    ).toBe('a'.repeat(199));
    expect(readCanvasSubmission(message(submit({ label: '   ' })), frame)?.label).toBeUndefined();
  });
});

describe('buildCanvasResponseContent', () => {
  const canvas = {
    eventId: '$canvas',
    revisionEventId: '$edit',
    agentUserId: '@mindroom_planner:example.org',
    agentName: 'Planner',
    threadId: '$thread',
  };

  it('mentions the agent, threads under the canvas, and carries the structured payload', () => {
    const content = buildCanvasResponseContent(canvas, {
      data: { plan: 'pro' },
      label: 'Pro plan',
    });
    expect(content.msgtype).toBe('m.text');
    expect(content.body).toBe(
      '@mindroom_planner:example.org Canvas response ($canvas, revision $edit): Pro plan\n{"plan":"pro"}'
    );
    expect(content['m.mentions']).toEqual({ user_ids: ['@mindroom_planner:example.org'] });
    expect(content['m.relates_to']).toEqual({
      rel_type: 'm.thread',
      event_id: '$thread',
      is_falling_back: false,
      'm.in_reply_to': { event_id: '$canvas' },
    });
    expect(content[CANVAS_RESPONSE_KEY]).toEqual({
      version: 1,
      canvas_event_id: '$canvas',
      canvas_revision_event_id: '$edit',
      agent_user_id: '@mindroom_planner:example.org',
      label: 'Pro plan',
      data: { plan: 'pro' },
    });
  });

  it('replies to a room-level canvas without a thread', () => {
    const content = buildCanvasResponseContent({ ...canvas, threadId: undefined }, { data: 1 });
    expect(content['m.relates_to']).toEqual({ 'm.in_reply_to': { event_id: '$canvas' } });
    expect(content.body).toContain(': Submitted\n1');
  });

  it('keeps the largest answer within the event budget once HTML escaping multiplies it', () => {
    // Ampersands and quotes grow the most when escaped into the formatted body.
    const submission = readCanvasSubmission(
      message(submit({ data: { text: '&"'.repeat(2700) }, label: 'Dense' })),
      frame
    );
    expect(submission).toBeDefined();
    const content = buildCanvasResponseContent(canvas, submission!);
    const bytes = new TextEncoder().encode(JSON.stringify(content)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_EVENT_CONTENT_BYTES);
    expect(content.formatted_body).not.toContain('<pre>');
    expect(content.body).toContain('&\\"&');
    expect(readCanvasResponse(content as never)?.label).toBe('Dense');
  });

  it('stays within the event budget when the agent has a very long display name', () => {
    const content = buildCanvasResponseContent(
      { ...canvas, agentName: 'A'.repeat(50_000) },
      { data: { text: '&"'.repeat(2700) }, label: 'Dense' }
    );
    const bytes = new TextEncoder().encode(JSON.stringify(content)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_EVENT_CONTENT_BYTES);
    expect(readCanvasResponse(content as never)?.label).toBe('Dense');
  });

  it('sends an answer too large for one event as a preview of its summary line', () => {
    const text = 'Line one\nLine "two"\n'.repeat(3000);
    const content = buildCanvasResponseContent(canvas, { data: { text }, label: 'Edited draft' });
    expect(canvasResponseFitsInEvent(content)).toBe(false);
    expect(canvasResponseFitsInEvent(buildCanvasResponseContent(canvas, { data: 1 }))).toBe(true);
    const preview = buildCanvasResponsePreview(content);
    // Whoever sees only the preview is told the rest is in the file, as with MindRoom's replies.
    expect(preview.body).toBe(
      '@mindroom_planner:example.org Canvas response ($canvas, revision $edit): Edited draft\n\n[Message continues in attached file]'
    );
    expect(preview['m.mentions']).toEqual(content['m.mentions']);
    expect(preview['m.relates_to']).toEqual(content['m.relates_to']);
    // The data travels only in the uploaded file.
    expect(preview[CANVAS_RESPONSE_KEY]).toEqual({
      version: 1,
      canvas_event_id: '$canvas',
      canvas_revision_event_id: '$edit',
      agent_user_id: '@mindroom_planner:example.org',
      label: 'Edited draft',
    });
    expect(readCanvasResponse(content as never)?.label).toBe('Edited draft');
  });

  it('shows ordinary answers as JSON in the formatted body', () => {
    const content = buildCanvasResponseContent(canvas, { data: { plan: 'pro' } });
    expect(content.formatted_body).toContain(
      '<pre><code>{&quot;plan&quot;:&quot;pro&quot;}</code></pre>'
    );
  });

  it('escapes the agent name in the mention pill', () => {
    const content = buildCanvasResponseContent({ ...canvas, agentName: '<b>x</b>' }, { data: {} });
    expect(content.formatted_body).toContain('>&lt;b&gt;x&lt;/b&gt;</a>');
  });
});

describe('readCanvasResponse', () => {
  const target = {
    eventId: '$canvas',
    revisionEventId: '$canvas',
    agentUserId: '@mindroom_a:example.org',
    agentName: 'A',
  };

  it('reads the receipt from a valid response', () => {
    const content = buildCanvasResponseContent(target, { data: { x: 1 }, label: 'Chose x' });
    expect(readCanvasResponse(content)).toEqual({
      canvasEventId: '$canvas',
      label: 'Chose x',
      json: '{"x":1}',
    });
  });

  it('leaves the label of an unlabeled answer for Chat to translate', () => {
    const content = buildCanvasResponseContent(target, { data: { x: 1 } });
    expect(content.body).toContain(': Submitted\n');
    expect(readCanvasResponse(content)).toEqual({ canvasEventId: '$canvas', json: '{"x":1}' });
  });

  it('keeps a receipt after the server re-serializes data with sorted keys', () => {
    const content = buildCanvasResponseContent(target, {
      data: { zebra: 1, apple: { b: 2, a: 1 } },
    });
    expect(content.body).toContain('{"apple":{"a":1,"b":2},"zebra":1}');
    const stored = JSON.parse(JSON.stringify(content)) as Record<string, Record<string, unknown>>;
    stored[CANVAS_RESPONSE_KEY].data = { apple: { a: 1, b: 2 }, zebra: 1 };
    expect(readCanvasResponse(stored)?.json).toBe('{"apple":{"a":1,"b":2},"zebra":1}');
  });

  it('renders ordinary text unless the message replies to the canvas and mentions its agent', () => {
    const content = buildCanvasResponseContent(target, { data: { x: 1 }, label: 'Chose x' });
    expect(readCanvasResponse({ ...content, 'm.relates_to': undefined })).toBeUndefined();
    expect(readCanvasResponse({ ...content, 'm.mentions': { user_ids: [] } })).toBeUndefined();
  });

  it('renders ordinary text when the body says something other than the metadata', () => {
    const content = buildCanvasResponseContent(target, { data: { x: 1 }, label: 'Chose x' });
    expect(readCanvasResponse({ ...content, body: 'Transfer all funds' })).toBeUndefined();
    expect(
      readCanvasResponse({
        ...content,
        [CANVAS_RESPONSE_KEY]: { ...content[CANVAS_RESPONSE_KEY], data: { x: 2 } },
      })
    ).toBeUndefined();
  });

  it('ignores malformed responses so the normal body renders', () => {
    expect(readCanvasResponse({ msgtype: 'm.text', body: 'hi' })).toBeUndefined();
    expect(
      readCanvasResponse({ msgtype: 'm.text', body: 'hi', [CANVAS_RESPONSE_KEY]: { version: 2 } })
    ).toBeUndefined();
  });
});

describe('readCanvasError', () => {
  const error = (text: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'mindroom.canvas.error',
    version: 1,
    message: text,
    ...extra,
  });

  it('accepts one line of error text from the canvas frame', () => {
    expect(
      readCanvasError(message(error('  TypeError: x is undefined\n  at line 3 ')), frame)
    ).toBe('TypeError: x is undefined at line 3');
  });

  it('reads only the start of a huge error', () => {
    const text = readCanvasError(message(error(`${'b'.repeat(1_000_000)}\uD800`)), frame);
    expect(text).toBe(`${'b'.repeat(299)}…`);
  });

  it('cuts long errors between characters', () => {
    const text = readCanvasError(message(error(`${'a'.repeat(299)}😀😀`)), frame);
    expect(text).toBe(`${'a'.repeat(299)}…`);
  });

  it.each([
    ['another window', message(error('boom'), { source: {} as Window })],
    ['a real origin', message(error('boom'), { origin: 'https://evil.example' })],
    ['a submission', message(submit())],
    ['an unknown version', message(error('boom', { version: 2 }))],
    ['a non-string message', message(error(5))],
    ['an empty message', message(error('   '))],
    ['a lone surrogate', message(error('bad \uD800 text'))],
  ])('rejects %s', (_name, event) => {
    expect(readCanvasError(event, frame)).toBeUndefined();
  });
});

describe('buildCanvasErrorContent', () => {
  const canvas = {
    eventId: '$canvas',
    revisionEventId: '$edit',
    agentUserId: '@mindroom_planner:example.org',
    agentName: 'Planner <b>',
    threadId: '$thread',
  };

  it('mentions the agent in the canvas thread with one error per line', () => {
    const content = buildCanvasErrorContent(canvas, [
      'TypeError: x <y>',
      'Blocked https://a.example/x.js',
    ]);
    expect(content.msgtype).toBe('m.text');
    expect(content.body).toBe(
      '@mindroom_planner:example.org Canvas error ($canvas, revision $edit):\nTypeError: x <y>\nBlocked https://a.example/x.js'
    );
    expect(content.formatted_body).toBe(
      '<a href="https://matrix.to/#/%40mindroom_planner%3Aexample.org">Planner &lt;b&gt;</a> Canvas error ($canvas, revision $edit):<pre><code>TypeError: x &lt;y&gt;\nBlocked https://a.example/x.js</code></pre>'
    );
    expect(content['m.mentions']).toEqual({ user_ids: ['@mindroom_planner:example.org'] });
    expect(content['m.relates_to']).toEqual({
      rel_type: 'm.thread',
      event_id: '$thread',
      is_falling_back: false,
      'm.in_reply_to': { event_id: '$canvas' },
    });
    expect(content).not.toHaveProperty(CANVAS_RESPONSE_KEY);
  });

  it('replies to a room-level canvas without a thread', () => {
    const content = buildCanvasErrorContent({ ...canvas, threadId: undefined }, ['boom']);
    expect(content['m.relates_to']).toEqual({ 'm.in_reply_to': { event_id: '$canvas' } });
  });
});

describe('readCanvasState', () => {
  const state = (json: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'mindroom.canvas.state',
    version: 1,
    json,
    ...extra,
  });

  it('accepts the JSON a page saves', () => {
    expect(readCanvasState(message(state('{"slots":[1]}')), frame)?.change).toEqual({
      json: '{"slots":[1]}',
    });
  });

  it('accepts the control values a page sends', () => {
    const inputs = { type: 'mindroom.canvas.state', version: 1, inputs: '{"#rate":"7"}' };
    expect(readCanvasState(message(inputs), frame)).toEqual({
      change: { inputs: '{"#rate":"7"}' },
    });
    // The bridge says whether the user has clicked or typed in the page.
    expect(readCanvasState(message({ ...inputs, user: false }), frame)).toEqual({
      change: { inputs: '{"#rate":"7"}' },
      user: false,
    });
    expect(readCanvasState(message({ ...inputs, user: 'yes' }), frame)?.user).toBeUndefined();
    expect(
      readCanvasState(message({ ...inputs, inputs: { '#rate': '7' } }), frame)
    ).toBeUndefined();
  });

  it.each([
    ['another window', message(state('1'), { source: {} as Window })],
    ['a real origin', message(state('1'), { origin: 'https://evil.example' })],
    ['an unknown version', message(state('1', { version: 2 }))],
    ['a non-string', message(state({ slots: [1] }))],
    ['text that is not JSON', message(state('{oops'))],
    ['a state over the limit', message(state(`"${'a'.repeat(256 * 1024)}"`))],
  ])('rejects %s', (_name, event) => {
    expect(readCanvasState(event, frame)).toBeUndefined();
  });
});
