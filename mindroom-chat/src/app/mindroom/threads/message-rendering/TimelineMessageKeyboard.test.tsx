import React, { createRef } from 'react';
import { EventTimelineSet, MatrixEvent, type Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, makeRoom } from '../test-utils/RoomTimeline.test.shared';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { MessageLayout, MessageSpacing } from '../../../state/settings';
import { BlockType } from '../../../components/editor/types';

// Keep timeline presentation fixtures, but exercise real message selection and editor guards.
vi.doUnmock('../../../utils/room');
vi.doUnmock('../../../utils/dom');
vi.doMock('../../../components/editor', async () => ({
  ...(await vi.importActual('../../../components/editor/utils')),
}));

const message = (id: string, sender = '@alice:example.org', content = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: id, ...content },
  });

const timeline = (events: MatrixEvent[]) => {
  const live = new EventTimelineSet(undefined).getLiveTimeline();
  live.getEvents().push(...events);
  return live;
};

beforeEach(() => {
  Object.assign(document, {
    activeElement: {
      nodeName: 'DIV',
      getAttribute: (name: string) =>
        ({ 'data-editable-name': 'RoomInput', contenteditable: 'true' }[name]),
    },
  });
});

const mountKeyboard = async (
  threadEvents?: MatrixEvent[],
  initialThreadId?: string,
  rootEvent?: MatrixEvent
) => {
  const { useTimelineMessageFeature } = await import('./useTimelineMessageFeature');
  const room = makeRoom({ liveEvents: [] }) as unknown as Room;
  const threads = new Map(
    threadEvents ? [['$root', { liveTimeline: timeline(threadEvents), rootEvent }]] : []
  );
  room.getThread = vi.fn((id) => threads.get(id) ?? null) as unknown as Room['getThread'];
  room.getLiveTimeline = () => timeline([message('$room-message')]);
  const editor = createEditor();
  editor.children = [{ type: BlockType.Paragraph, children: [{ text: '' }] }];
  let feature!: ReturnType<typeof useTimelineMessageFeature>;
  const Harness = ({ threadId }: { threadId?: string }) => {
    feature = useTimelineMessageFeature({
      room,
      editor,
      threadId,
      scrollRef: createRef<HTMLDivElement>(),
      showThreadRepliesInRoom: false,
      messageLayout: MessageLayout.Compact,
      messageSpacing: '400' as MessageSpacing,
      hideActivity: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      showHiddenEvents: false,
    });
    return null;
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness threadId={initialThreadId} />);
  });
  return {
    editor,
    switchThread: (threadId?: string) =>
      act(() => renderer.update(<Harness threadId={threadId} />)),
    pressUp: () => {
      const event = { key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      const calls = vi.mocked(useKeyDown).mock.calls;
      act(() => calls[calls.length - 1][1](event));
      return { editingEventId: feature.editingEventId, prevented: event.preventDefault };
    },
  };
};

describe('Up-arrow message editing', () => {
  it('edits the latest own message in the active thread, skipping ineligible events', async () => {
    const keyboard = await mountKeyboard(
      [
        message('$root'),
        message('$older'),
        message('$latest', undefined, {
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        }),
        message('$other-user', '@bob:example.org'),
        message('$image', undefined, { msgtype: 'm.image' }),
        message('$replacement', undefined, {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$latest' },
        }),
        message('~pending'),
      ],
      '$root',
      message('$root')
    );
    const result = keyboard.pressUp();
    expect(result.editingEventId).toBe('$latest');
    expect(result.prevented).toHaveBeenCalledOnce();
  });

  it('keeps normal room editing and follows thread navigation without remounting', async () => {
    const keyboard = await mountKeyboard([message('$root'), message('$reply')]);
    expect(keyboard.pressUp().editingEventId).toBe('$room-message');
    keyboard.switchThread('$root');
    expect(keyboard.pressUp().editingEventId).toBe('$reply');
    keyboard.switchThread();
    expect(keyboard.pressUp().editingEventId).toBe('$room-message');
  });

  it.each([
    { name: 'unavailable', events: undefined },
    { name: 'empty', events: [] },
    { name: 'only another sender', events: [message('$other-user', '@bob:example.org')] },
  ])('does not fall back to a room message when the thread is $name', async ({ events }) => {
    const keyboard = await mountKeyboard(events, '$root');
    const result = keyboard.pressUp();
    expect(result.editingEventId).toBeUndefined();
    expect(result.prevented).not.toHaveBeenCalled();
  });

  it('allows editing a separately stored own thread root when there are no own replies', async () => {
    const keyboard = await mountKeyboard(
      [message('$reply', '@bob:example.org')],
      '$root',
      message('$root')
    );
    expect(keyboard.pressUp().editingEventId).toBe('$root');
  });

  it.each([
    { name: 'another sender', root: message('$root', '@bob:example.org') },
    { name: 'pending', root: message('~root') },
  ])('does not edit a separately stored $name root', async ({ root }) => {
    const keyboard = await mountKeyboard([], '$root', root);
    const result = keyboard.pressUp();
    expect(result.editingEventId).toBeUndefined();
    expect(result.prevented).not.toHaveBeenCalled();
  });

  it('leaves a nonempty draft alone', async () => {
    const keyboard = await mountKeyboard([message('$reply')], '$root');
    keyboard.editor.children = [{ type: BlockType.Paragraph, children: [{ text: 'draft' }] }];
    const result = keyboard.pressUp();
    expect(result.editingEventId).toBeUndefined();
    expect(result.prevented).not.toHaveBeenCalled();
  });

  it('does not edit while another input has focus', async () => {
    const keyboard = await mountKeyboard([message('$reply')], '$root');
    Object.assign(document, { activeElement: { nodeName: 'INPUT', getAttribute: () => null } });
    expect(keyboard.pressUp().editingEventId).toBeUndefined();
  });
});
