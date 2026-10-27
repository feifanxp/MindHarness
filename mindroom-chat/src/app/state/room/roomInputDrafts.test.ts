import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRoomInputDrafts, roomIdToMsgDraftAtomFamily } from './roomInputDrafts';

const KEY = JSON.stringify(['@alice:example.org', '!room:example.org', '$thread']);
const draft = [{ type: 'paragraph' as const, children: [{ text: 'Unsent draft', bold: true }] }];

describe('message draft persistence', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
      get length() {
        return values.size;
      },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    roomIdToMsgDraftAtomFamily.remove(KEY);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('restores formatted text after all in-memory draft state is lost', () => {
    createStore().set(roomIdToMsgDraftAtomFamily(KEY), draft);
    roomIdToMsgDraftAtomFamily.remove(KEY);
    expect(createStore().get(roomIdToMsgDraftAtomFamily(KEY))).toEqual(draft);
  });

  it('removes a cleared draft from storage', () => {
    const store = createStore();
    const atom = roomIdToMsgDraftAtomFamily(KEY);
    store.set(atom, draft);
    expect(values.size).toBe(1);
    store.set(atom, []);
    expect(values.size).toBe(0);
    roomIdToMsgDraftAtomFamily.remove(KEY);
    expect(createStore().get(roomIdToMsgDraftAtomFamily(KEY))).toEqual([]);
  });

  it('revokes stale writes after account cleanup while permitting a fresh session', () => {
    const store = createStore();
    const staleAtom = roomIdToMsgDraftAtomFamily(KEY);
    store.set(staleAtom, draft);
    clearRoomInputDrafts('@alice:example.org');
    store.set(staleAtom, draft);
    expect(values.size).toBe(0);
    const freshAtom = roomIdToMsgDraftAtomFamily(KEY);
    expect(store.get(freshAtom)).toEqual([]);
    store.set(freshAtom, draft);
    expect(values.size).toBe(1);
  });

  it('keeps drafts usable when storage writes fail', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Storage full');
      },
      removeItem: () => {
        throw new Error('Storage blocked');
      },
    });
    const store = createStore();
    const atom = roomIdToMsgDraftAtomFamily(KEY);
    expect(() => store.set(atom, draft)).not.toThrow();
    expect(store.get(atom)).toEqual(draft);
  });

  it.each(['{invalid', '{}', '[{"type":"paragraph","children":[]}]', '[{"text":5}]'])(
    'ignores corrupt stored editor content: %s',
    (invalid) => {
      createStore().set(roomIdToMsgDraftAtomFamily(KEY), draft);
      values.forEach((_, key) => values.set(key, invalid));
      roomIdToMsgDraftAtomFamily.remove(KEY);
      expect(createStore().get(roomIdToMsgDraftAtomFamily(KEY))).toEqual([]);
    }
  );
});
