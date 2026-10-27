import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createEditor, Editor, Node, Transforms } from 'slate';
import { withHistory } from 'slate-history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomInputDraft } from './useRoomInputDraft';
import { resetEditor } from '../../components/editor/utils';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../../state/room/roomInputDrafts';

const ROOM = '!draft-room:example.org';
const USER = '@draft-user:example.org';
const empty = () => [{ type: 'paragraph' as const, children: [{ text: '' }] }];
const makeEditor = () => {
  const editor = withHistory(createEditor());
  editor.children = empty();
  return editor;
};

const Harness = ({
  editor,
  userId = USER,
  roomId = ROOM,
  threadId,
}: {
  editor: Editor;
  userId?: string;
  roomId?: string;
  threadId?: string;
}) => {
  const saveDraft = useRoomInputDraft(editor, userId, roomId, threadId);
  editor.onChange = saveDraft;
  return null;
};

describe('composer draft lifecycle', () => {
  let renderer: ReactTestRenderer | undefined;
  let store: ReturnType<typeof createStore>;
  let values: Map<string, string>;

  beforeEach(() => {
    renderer = undefined;
    store = createStore();
    values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    roomIdToMsgDraftAtomFamily.setShouldRemove(() => true);
    roomIdToMsgDraftAtomFamily.setShouldRemove(null);
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  const mount = async (editor: Editor, threadId?: string, userId = USER, roomId = ROOM) => {
    await act(async () => {
      const tree = React.createElement(
        Provider,
        { store },
        React.createElement(Harness, { editor, threadId, userId, roomId })
      );
      if (renderer) renderer.update(tree);
      else renderer = create(tree);
    });
  };
  const type = async (editor: Editor, text: string) => {
    await act(async () => Transforms.insertText(editor, text));
  };

  it('keeps room and thread drafts separate when the same editor changes destination', async () => {
    const editor = makeEditor();
    await mount(editor, '$a');
    await type(editor, 'Draft A');
    await mount(editor);
    expect(Node.string(editor)).toBe('');
    await type(editor, 'Room draft');
    await mount(editor, '$b');
    expect(Node.string(editor)).toBe('');
    await type(editor, 'Draft B');
    await mount(editor, '$a');
    expect(Node.string(editor)).toBe('Draft A');
    await mount(editor, '$b');
    expect(Node.string(editor)).toBe('Draft B');
    await mount(editor);
    expect(Node.string(editor)).toBe('Room draft');
  });

  it('saves while typing and restores after a reload without unmount cleanup', async () => {
    const editor = makeEditor();
    await mount(editor, '$a');
    await type(editor, 'Saved before navigation');
    expect([...values.values()].some((value) => value.includes('Saved before navigation'))).toBe(
      true
    );
    roomIdToMsgDraftAtomFamily.setShouldRemove(() => true);
    roomIdToMsgDraftAtomFamily.setShouldRemove(null);
    const nextEditor = makeEditor();
    let nextRenderer: ReactTestRenderer;
    await act(async () => {
      nextRenderer = create(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(Harness, { editor: nextEditor, threadId: '$a' })
        )
      );
    });
    expect(Node.string(nextEditor)).toBe('Saved before navigation');
    await act(async () => nextRenderer.unmount());
  });

  it('does not resurrect sent or deleted text after remounting', async () => {
    const editor = makeEditor();
    await mount(editor, '$a');
    await type(editor, 'Send this');
    await act(async () => resetEditor(editor));
    await act(async () => renderer?.unmount());
    renderer = undefined;
    const nextEditor = makeEditor();
    await mount(nextEditor, '$a');
    expect(Node.string(nextEditor)).toBe('');
    expect(values.size).toBe(0);
  });

  it('isolates drafts by account and room', async () => {
    const editor = makeEditor();
    await mount(editor, '$a');
    await type(editor, 'Private draft');
    await mount(editor, '$a', '@other:example.org');
    expect(Node.string(editor)).toBe('');
    await mount(editor, '$a', USER, '!other:example.org');
    expect(Node.string(editor)).toBe('');
    await mount(editor, '$a');
    expect(Node.string(editor)).toBe('Private draft');
  });

  it('restores a background failure alongside newer typing exactly once', async () => {
    const editor = makeEditor();
    await mount(editor, '$a');
    await type(editor, 'New draft');
    const atom = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(USER, ROOM, '$a'));
    await act(async () =>
      store.set(atom, [
        { type: 'paragraph', children: [{ text: 'Failed caption' }] },
        ...store.get(atom),
      ])
    );
    expect(editor.children).toEqual([
      { type: 'paragraph', children: [{ text: 'Failed caption' }] },
      { type: 'paragraph', children: [{ text: 'New draft' }] },
    ]);
    await type(editor, ' continued');
    await mount(editor, '$b');
    await mount(editor, '$a');
    expect(Node.string(editor)).toBe('Failed captionNew draft continued');
  });
});
