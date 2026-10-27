import { describe, expect, it, vi } from 'vitest';
import { Editor, createEditor } from 'slate';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
} from '../../components/editor/autocomplete/autocompleteQuery';
import {
  createMindroomRoomInputPasteMarkerElement,
  getMindroomRoomInputPasteMarkerFileNames,
  isMindroomRoomInputAutocompleteQuery,
  MindroomRoomInputAutocomplete,
  MindroomRoomInputReplyContext,
  MindroomRoomInputThreadIndicator,
  removeMindroomRoomInputPasteMarkerElements,
} from './RoomInputMindroomExtensions';
import { BlockType } from '../../components/editor/types';

vi.mock('../commands/MindroomCommandAutocomplete', () => ({
  MindroomCommandAutocomplete: () => null,
}));

vi.mock('../threads/ThreadIndicator', () => ({
  ThreadIndicator: () => null,
}));

vi.mock('../messages/PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

vi.mock('../voice/VoiceRecorderDialog', () => ({
  VoiceRecorderComposer: () => null,
}));

const range = {
  anchor: { path: [0, 0], offset: 0 },
  focus: { path: [0, 0], offset: 1 },
};

const query = (prefix: string): AutocompleteQuery<string> => ({
  range,
  prefix,
  text: '',
});

describe('RoomInputMindroomExtensions', () => {
  it('recognizes only MindRoom room-input autocomplete queries', () => {
    expect(isMindroomRoomInputAutocompleteQuery(query('!'))).toBe(true);
    expect(isMindroomRoomInputAutocompleteQuery(query(AutocompletePrefix.Command))).toBe(false);
    expect(isMindroomRoomInputAutocompleteQuery(undefined)).toBe(false);
  });

  it('does not render MindRoom autocomplete for upstream room-input queries', () => {
    expect(
      MindroomRoomInputAutocomplete({
        editor: {} as Editor,
        query: query(AutocompletePrefix.Command),
        requestClose: () => undefined,
      })
    ).toBeNull();
  });

  it('renders the thread indicator only for threaded reply drafts', () => {
    expect(
      MindroomRoomInputThreadIndicator({
        room: {} as never,
        relation: undefined,
      })
    ).toBeNull();

    expect(
      MindroomRoomInputThreadIndicator({
        room: {} as never,
        relation: {
          event_id: '$thread',
          rel_type: 'm.thread',
        } as never,
      })
    ).not.toBeNull();
  });

  it('renders the composer context only for replies or pending sends', () => {
    expect(
      MindroomRoomInputReplyContext({
        room: {} as never,
        relation: undefined,
      })
    ).toBeNull();

    expect(
      MindroomRoomInputReplyContext({
        pendingSend: true,
        room: {} as never,
        relation: undefined,
      })
    ).not.toBeNull();

    expect(
      MindroomRoomInputReplyContext({
        children: 'reply',
        room: {} as never,
        relation: undefined,
      })
    ).not.toBeNull();
  });

  it('creates and finds paste marker editor nodes', () => {
    const marker =
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';
    const element = createMindroomRoomInputPasteMarkerElement({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      raw: marker,
    });

    expect(element).toEqual({
      type: BlockType.PasteMarker,
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      marker,
      children: [{ text: '' }],
    });

    expect(
      getMindroomRoomInputPasteMarkerFileNames([
        {
          type: BlockType.Paragraph,
          children: [{ text: 'Before ' }, element, { text: ' after' }],
        },
      ])
    ).toEqual(new Set(['mindroom-paste-a3f19c.txt']));

    const editor = createEditor();
    editor.children = [
      {
        type: BlockType.Paragraph,
        children: [{ text: 'Before ' }, element, { text: ' after' }],
      },
    ];

    removeMindroomRoomInputPasteMarkerElements(editor, new Set(['mindroom-paste-a3f19c.txt']));

    expect(getMindroomRoomInputPasteMarkerFileNames(editor.children)).toEqual(new Set());
  });
});
