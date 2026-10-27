import React from 'react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { Reply } from './Reply';

vi.mock('./Reply.css', () => ({ Reply: '', ReplyContent: '' }));
vi.mock('./placeholder', () => ({ LinePlaceholder: () => null }));
vi.mock('./content', () => ({
  MessageBadEncryptedContent: () => null,
  MessageDeletedContent: () => null,
  MessageFailedContent: () => null,
}));
vi.mock('../../plugins/react-custom-html-parser', () => ({
  scaleSystemEmoji: (text: string) => text,
}));
vi.mock('../../mindroom/messages/replyExtensions', () => ({
  // Keep the real Matrix event and preview formatting; avoid fetching a room.
  useMindroomReplyEvent: (_room: Room, _id: string, getLocal: () => MatrixEvent) => getLocal(),
  MindroomReplyThreadIndicator: () => null,
}));

it('shows compact readable tool summaries in replies and updates after an edit', () => {
  const event = new MatrixEvent({
    event_id: '$message',
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: '🔧 `read_file` [1]\n\n🔧 `edit_file` [2]\n\n**Updated `config.yaml`**.',
    },
  });
  const room = { findEventById: () => event } as unknown as Room;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Reply room={room} replyEventId="$message" />);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('🔧 2 tools · Updated config.yaml.');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('read_file');

  event.event.content = { msgtype: 'm.text', body: '**Finished**.\n\n```\n🔧 `example` [1]\n```' };
  act(() => {
    renderer.update(<Reply room={room} replyEventId="$message" />);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('Finished.');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('2 tools');
  expect(JSON.stringify(renderer.toJSON())).toContain('🔧 example [1]');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('1 tool');
  act(() => renderer.unmount());
});

it('shows mentioned room members by display name, as their pills read', () => {
  const event = new MatrixEvent({
    event_id: '$handoff',
    type: 'm.room.message',
    sender: '@mindroom_forge:server',
    content: {
      msgtype: 'm.text',
      // MindRoom agents write mentions as full Matrix IDs in the plain body.
      body: '@mindroom_quill:server Signups failed after a bad deploy. Ask @priya:server, not @gone:elsewhere.',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<a href="https://matrix.to/#/@mindroom_quill:server">@Quill</a> Signups failed after a bad deploy.',
    },
  });
  const names: Record<string, string> = {
    '@mindroom_forge:server': 'Forge',
    '@mindroom_quill:server': 'Quill',
    '@priya:server': 'Priya Raman',
  };
  const room = {
    findEventById: () => event,
    getMember: (userId: string) =>
      names[userId] ? { userId, rawDisplayName: names[userId] } : null,
  } as unknown as Room;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Reply room={room} replyEventId="$handoff" />);
  });
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain(
    '@Quill Signups failed after a bad deploy. Ask @Priya Raman, not @gone:elsewhere.'
  );
  expect(text).not.toContain('@mindroom_quill:server');
  act(() => renderer.unmount());
});
