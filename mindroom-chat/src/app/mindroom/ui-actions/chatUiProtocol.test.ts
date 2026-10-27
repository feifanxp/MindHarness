import { describe, expect, it } from 'vitest';
import { readCanvasNoticeTitle, readChatUiAction } from './chatUiProtocol';
import { agentId, makeUiEvent, makeUiRoom, viewerId } from './testUtils';

describe('readChatUiAction', () => {
  it('binds a computer request to its event, actual sender, and canonical thread', () => {
    const { room } = makeUiRoom();
    expect(readChatUiAction(makeUiEvent(), viewerId, room)).toEqual({
      eventId: '$request',
      action: 'show_computer',
      agentUserId: agentId,
      threadId: '$thread',
    });
  });

  it.each([
    'general',
    'account',
    'notifications',
    'devices',
    'emojis-stickers',
    'developer',
    'about',
  ])('accepts the supported settings section %s', (section) => {
    const { room } = makeUiRoom();
    expect(
      readChatUiAction(makeUiEvent({ action: 'open_settings', section }), viewerId, room)
    ).toMatchObject({ action: 'open_settings', section });
  });

  it('accepts the existing Members side panel', () => {
    const { room } = makeUiRoom();
    expect(
      readChatUiAction(makeUiEvent({ action: 'open_panel', panel: 'members' }), viewerId, room)
    ).toMatchObject({ action: 'open_panel', panel: 'members' });
  });

  it('accepts a room request only when it has no thread relation', () => {
    const { room } = makeUiRoom();
    const event = makeUiEvent({ thread_id: null });
    delete event.event.content!['m.relates_to'];
    expect(readChatUiAction(event, viewerId, room)?.threadId).toBeUndefined();
    expect(readChatUiAction(makeUiEvent({ thread_id: null }), viewerId, room)).toBeUndefined();
  });

  it.each([
    { version: 2 },
    { version: true },
    { action: 'eval', javascript: 'alert(1)' },
    { action: 'open_settings', section: 'https://evil.example' },
    { action: 'open_panel', panel: 'unknown' },
    { requester_id: '@bob:example.org' },
    { agent_user_id: '@mindroom_second:example.org' },
    { room_id: '!another:example.org' },
    { thread_id: '$another' },
    { thread_id: undefined },
  ])('rejects unsupported or inconsistent metadata %j', (metadata) => {
    const { room } = makeUiRoom();
    expect(readChatUiAction(makeUiEvent(metadata), viewerId, room)).toBeUndefined();
  });

  it('rejects foreign, ordinary, and departed senders', () => {
    const { room } = makeUiRoom();
    ['@mindroom_foreign:elsewhere.org', viewerId, '@mindroom_departed:example.org'].forEach(
      (sender) => {
        expect(
          readChatUiAction(makeUiEvent({ agent_user_id: sender }, { sender }), viewerId, room)
        ).toBeUndefined();
      }
    );
  });

  it('rejects edits, edited originals, redactions, local echoes, and non-notice messages', () => {
    const { room } = makeUiRoom();
    const edit = makeUiEvent();
    edit.event.content!['m.relates_to'] = { rel_type: 'm.replace', event_id: '$original' };
    const edited = makeUiEvent();
    edited.makeReplaced(edit);
    const redacted = makeUiEvent();
    redacted.makeRedacted(makeUiEvent({}, { type: 'm.room.redaction' }), room);
    const text = makeUiEvent();
    text.event.content!.msgtype = 'm.text';
    [edit, edited, redacted, text, makeUiEvent({}, { event_id: undefined })].forEach((event) => {
      expect(readChatUiAction(event, viewerId, room)).toBeUndefined();
    });
  });

  describe('show_canvas', () => {
    const canvas = { title: 'Choose a plan', html: '<button>Pro</button>' };
    const canvasEdit = (metadata: Record<string, unknown>) =>
      makeUiEvent(
        {},
        {
          event_id: '$edit',
          content: {
            msgtype: 'm.notice',
            body: '* Updated panel',
            'm.relates_to': { rel_type: 'm.replace', event_id: '$request' },
            'm.new_content': {
              msgtype: 'm.notice',
              body: 'Updated panel',
              'io.mindroom.ui_action': {
                version: 1,
                action: 'show_canvas',
                requester_id: viewerId,
                agent_user_id: agentId,
                room_id: '!room:example.org',
                thread_id: '$thread',
                ...metadata,
              },
            },
          },
        }
      );

    it('reads the canvas title and HTML', () => {
      const { room } = makeUiRoom();
      const event = makeUiEvent({ action: 'show_canvas', canvas });
      expect(readChatUiAction(event, viewerId, room)).toEqual({
        eventId: '$request',
        action: 'show_canvas',
        agentUserId: agentId,
        threadId: '$thread',
        canvas,
        revisionEventId: '$request',
        event,
      });
    });

    it.each([
      { canvas: undefined },
      { canvas: { title: '', html: '<p></p>' } },
      { canvas: { title: '   ', html: '<p></p>' } },
      { canvas: { title: 'x'.repeat(201), html: '<p></p>' } },
      { canvas: { title: 'Ok', html: 5 } },
      { canvas: { title: 'Ok', html: 'x'.repeat(128 * 1024 + 1) } },
    ])('rejects invalid canvas content %#', (metadata) => {
      const { room } = makeUiRoom();
      expect(
        readChatUiAction(makeUiEvent({ action: 'show_canvas', ...metadata }), viewerId, room)
      ).toBeUndefined();
    });

    it('reads a page uploaded as media, plain or encrypted', () => {
      const { room } = makeUiRoom();
      const document = { mimetype: 'text/html', size: 30_000, url: 'mxc://example.org/page' };
      expect(
        readChatUiAction(
          makeUiEvent({ action: 'show_canvas', canvas: { title: 'Report', document } }),
          viewerId,
          room
        )
      ).toMatchObject({
        canvas: { title: 'Report', document: { mxcUrl: 'mxc://example.org/page', size: 30_000 } },
      });
      const file = {
        url: 'mxc://example.org/enc',
        key: { k: 'key' },
        iv: 'iv',
        hashes: { sha256: 'hash' },
        v: 'v2',
      };
      expect(
        readChatUiAction(
          makeUiEvent({
            action: 'show_canvas',
            canvas: { title: 'Report', document: { mimetype: 'text/html', size: 10, file } },
          }),
          viewerId,
          room
        )
      ).toMatchObject({
        canvas: { document: { mxcUrl: 'mxc://example.org/enc', encryptedFile: file, size: 10 } },
      });
    });

    it.each([
      { mimetype: 'text/plain', size: 10, url: 'mxc://example.org/page' },
      { mimetype: 'text/html', size: 0, url: 'mxc://example.org/page' },
      { mimetype: 'text/html', size: 4 * 1024 * 1024 + 1, url: 'mxc://example.org/page' },
      { mimetype: 'text/html', size: 10, url: 'https://evil.example/page' },
      { mimetype: 'text/html', size: 10, file: { url: 'mxc://example.org/enc' } },
      {
        mimetype: 'text/html',
        size: 10,
        url: 'mxc://example.org/page',
        file: { url: 'mxc://example.org/enc', key: { k: 'k' }, iv: 'iv', hashes: { sha256: 'h' } },
      },
    ])('rejects an unusable page reference %#', (document) => {
      const { room } = makeUiRoom();
      expect(
        readChatUiAction(
          makeUiEvent({ action: 'show_canvas', canvas: { title: 'Report', document } }),
          viewerId,
          room
        )
      ).toBeUndefined();
    });

    it('shows the latest same-request edit of a canvas', () => {
      const { room } = makeUiRoom();
      const original = makeUiEvent({ action: 'show_canvas', canvas });
      original.makeReplaced(canvasEdit({ canvas: { title: 'Step 2', html: '<p>2</p>' } }));
      expect(readChatUiAction(original, viewerId, room)).toMatchObject({
        eventId: '$request',
        action: 'show_canvas',
        canvas: { title: 'Step 2', html: '<p>2</p>' },
        revisionEventId: '$edit',
      });
    });

    it('ignores an edit from another sender even when the SDK applied it', () => {
      const { room } = makeUiRoom();
      const original = makeUiEvent({ action: 'show_canvas', canvas });
      // Server-bundled edits reach the event without the SDK's sender check.
      original.makeReplaced(
        Object.assign(canvasEdit({ canvas: { title: 'Phish', html: '<p>log in</p>' } }), {
          getSender: () => '@mindroom_second:example.org',
        })
      );
      expect(readChatUiAction(original, viewerId, room)).toMatchObject({
        canvas,
        revisionEventId: '$request',
      });
    });

    it('keeps the original canvas when an edit changes its authority', () => {
      const { room } = makeUiRoom();
      [
        { requester_id: '@bob:example.org' },
        { thread_id: '$another' },
        { action: 'show_computer' },
        { canvas: { title: '', html: '' } },
        // An edit cannot start sharing what the user does in a page that never said so.
        { share_state: true },
      ].forEach((metadata) => {
        const original = makeUiEvent({ action: 'show_canvas', canvas });
        original.makeReplaced(canvasEdit({ canvas, ...metadata }));
        expect(readChatUiAction(original, viewerId, room)).toMatchObject({
          canvas,
          revisionEventId: '$request',
        });
      });
    });

    it('tells the panel when a canvas shares its state, and keeps it through edits', () => {
      const { room } = makeUiRoom();
      const original = makeUiEvent({ action: 'show_canvas', canvas, share_state: true });
      original.makeReplaced(
        canvasEdit({ canvas: { title: 'Step 2', html: '<p>2</p>' }, share_state: true })
      );
      expect(readChatUiAction(original, viewerId, room)).toMatchObject({
        shareState: true,
        revisionEventId: '$edit',
      });
      // An edit that drops sharing is no edit of this request.
      const quiet = makeUiEvent({ action: 'show_canvas', canvas, share_state: true });
      quiet.makeReplaced(canvasEdit({ canvas: { title: 'Step 2', html: '<p>2</p>' } }));
      expect(readChatUiAction(quiet, viewerId, room)).toMatchObject({
        shareState: true,
        revisionEventId: '$request',
      });
      expect(
        readChatUiAction(makeUiEvent({ action: 'show_canvas', canvas }), viewerId, room)
      ).not.toHaveProperty('shareState');
    });

    it('never treats the edit event itself as a request', () => {
      const { room } = makeUiRoom();
      expect(readChatUiAction(canvasEdit({ canvas }), viewerId, room)).toBeUndefined();
    });

    it('names a canvas notice by its title, for any viewer', () => {
      const shown = makeUiEvent({
        action: 'show_canvas',
        canvas,
        requester_id: '@bob:example.org',
      });
      expect(readCanvasNoticeTitle(shown.getContent())).toBe('Choose a plan');
      // An update's title, as the edited event shows it.
      const updated = makeUiEvent({ action: 'show_canvas', canvas });
      updated.makeReplaced(canvasEdit({ canvas: { title: 'Step 2', html: '<p>2</p>' } }));
      expect(readCanvasNoticeTitle(updated.getContent())).toBe('Step 2');
      [
        makeUiEvent(),
        makeUiEvent({ action: 'show_canvas', canvas, version: 2 }),
        makeUiEvent({ action: 'show_canvas', canvas: { title: ' ', html: '<p></p>' } }),
        makeUiEvent(
          {},
          {
            content: {
              msgtype: 'm.text',
              body: 'Hi',
              'io.mindroom.ui_action': { version: 1, action: 'show_canvas', canvas },
            },
          }
        ),
      ].forEach((event) => expect(readCanvasNoticeTitle(event.getContent())).toBeUndefined());
    });
  });
});
