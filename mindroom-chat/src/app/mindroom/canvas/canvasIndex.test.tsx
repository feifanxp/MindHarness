// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React, { Profiler } from 'react';
import { EventEmitter } from 'events';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  ClientEvent,
  MatrixEvent,
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import {
  loadCanvasEvent,
  recordCanvasEvent,
  useCanvasIndexRecorder,
  useComputerShown,
  useConversationCanvases,
  useHasListedCanvases,
  useOpenCanvasById,
} from './canvasIndex';
import {
  isComputerShown,
  listCanvases,
  recordCanvas,
  subscribeCanvasList,
} from './canvasIndexStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_planner:example.org';
const VIEWER = '@alice:example.org';
const HOMESERVER = 'https://example.org';
const SESSION = createSessionId(HOMESERVER, VIEWER);

const metadata = (title: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  action: 'show_canvas',
  requester_id: VIEWER,
  agent_user_id: AGENT,
  room_id: ROOM_ID,
  thread_id: '$thread',
  canvas: { title, html: '<p>Hi</p>' },
  ...extra,
});

const request = ({
  id = '$canvas',
  ts = 1,
  thread = '$thread' as string | null,
  extra = {} as Record<string, unknown>,
} = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: AGENT,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.notice',
      body: 'Interactive panel: Plans.',
      ...(thread ? { 'm.relates_to': { rel_type: 'm.thread', event_id: thread } } : {}),
      'io.mindroom.ui_action': metadata('Plans', { thread_id: thread, ...extra }),
    },
  });

const edit = (
  title: string,
  {
    id = '$edit',
    of = '$canvas',
    ts = 2,
    sender = AGENT,
    extra = {} as Record<string, unknown>,
  } = {}
) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.notice',
      body: `* Interactive panel: ${title}.`,
      'm.new_content': {
        msgtype: 'm.notice',
        body: `Interactive panel: ${title}.`,
        'io.mindroom.ui_action': metadata(title, extra),
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: of },
    },
  });

const computerNotice = ({
  id = '$computer',
  thread = '$thread' as string | null,
  sender = AGENT,
  extra = {} as Record<string, unknown>,
} = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: {
      msgtype: 'm.notice',
      body: 'Opening the computer.',
      ...(thread ? { 'm.relates_to': { rel_type: 'm.thread', event_id: thread } } : {}),
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_computer',
        requester_id: VIEWER,
        agent_user_id: sender,
        room_id: ROOM_ID,
        thread_id: thread,
        ...extra,
      },
    },
  });

type Fixture = {
  mx: MatrixClient & EventEmitter;
  room: Room;
  timeline: MatrixEvent[];
  relations: ReturnType<typeof vi.fn>;
};

const fixture = (): Fixture => {
  const timeline: MatrixEvent[] = [];
  const room = {
    roomId: ROOM_ID,
    getMember: (userId: string) => ({ userId, membership: 'join' }),
    getLiveTimeline: () => ({ getEvents: () => timeline }),
    getThreads: () => [],
    findEventById: (id: string) => timeline.find((event) => event.getId() === id),
  } as unknown as Room;
  const relations = vi.fn();
  const mx = Object.assign(new EventEmitter(), {
    getSafeUserId: () => VIEWER,
    getHomeserverUrl: () => HOMESERVER,
    getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
    getRooms: () => [room],
    relations,
  }) as unknown as Fixture['mx'];
  return { mx, room, timeline, relations };
};

const settle = async () => {
  // IndexedDB work finishes over several tasks.
  for (let index = 0; index < 5; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('recordCanvasEvent', () => {
  it('lists a canvas made for the viewer with where it is and whether it is shared', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request({ extra: { share_state: true } }));
    expect(await listCanvases(SESSION)).toEqual([
      {
        canvasId: '$canvas',
        roomId: ROOM_ID,
        threadId: '$thread',
        agentUserId: AGENT,
        title: 'Plans',
        revisionId: '$canvas',
        createdTs: 1,
        updatedTs: 1,
        shared: true,
      },
    ]);
  });

  it('ignores messages that are not canvases for the viewer', async () => {
    const { mx } = fixture();
    const plain = new MatrixEvent({
      event_id: '$plain',
      room_id: ROOM_ID,
      sender: AGENT,
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'Hello' },
    });
    expect(recordCanvasEvent(mx, plain)).toBeUndefined();
    expect(
      recordCanvasEvent(mx, request({ extra: { requester_id: '@bob:example.org' } }))
    ).toBeUndefined();
    const echo = request();
    echo.setStatus('sending' as never);
    expect(recordCanvasEvent(mx, echo)).toBeUndefined();
  });

  it('lists the update a loaded request shows', async () => {
    const { mx } = fixture();
    const canvas = request();
    canvas.makeReplaced(edit('Plans v2', { ts: 7 }));
    await recordCanvasEvent(mx, canvas);
    expect((await listCanvases(SESSION))[0]).toMatchObject({
      title: 'Plans v2',
      createdTs: 1,
      updatedTs: 7,
    });
  });

  it('forgets a canvas that turns up already deleted', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request());
    const deleted = request();
    deleted.makeRedacted(
      new MatrixEvent({ event_id: '$redaction', type: 'm.room.redaction', redacts: '$canvas' }),
      { getMyMembership: () => 'join', currentState: { getStateEvents: () => null } } as never
    );
    expect(deleted.isRedacted()).toBe(true);
    await recordCanvasEvent(mx, deleted);
    expect(await listCanvases(SESSION)).toEqual([]);
  });

  it('leaves the store alone for deletions that cannot be of a canvas', async () => {
    const { mx, timeline } = fixture();
    await recordCanvasEvent(mx, request());
    const reaction = (id: string) =>
      new MatrixEvent({
        event_id: id,
        room_id: ROOM_ID,
        sender: AGENT,
        type: 'm.reaction',
        content: {},
      });
    const redaction = (redacts: string) =>
      new MatrixEvent({
        event_id: `$redacts-${redacts}`,
        room_id: ROOM_ID,
        sender: AGENT,
        type: 'm.room.redaction',
        redacts,
      });
    const writes = vi.fn();
    const unsubscribe = subscribeCanvasList(writes);
    // Agents delete their stop-button reaction after every reply.
    timeline.push(reaction('$stop'));
    expect(recordCanvasEvent(mx, redaction('$stop'))).toBeUndefined();
    const deletedReaction = reaction('$old-stop');
    deletedReaction.makeRedacted(redaction('$old-stop'), {
      getMyMembership: () => 'join',
      currentState: { getStateEvents: () => null },
    } as never);
    expect(recordCanvasEvent(mx, deletedReaction)).toBeUndefined();
    // A deletion of an event not in memory may be of a canvas.
    await recordCanvasEvent(mx, redaction('$unknown'));
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await listCanvases(SESSION)).toHaveLength(1);
    unsubscribe();
  });

  it('falls back to the surviving version when the update a row shows is deleted', async () => {
    const { mx, timeline } = fixture();
    const canvas = request();
    canvas.makeReplaced(edit('Plans v2', { id: '$v2', ts: 7 }));
    await recordCanvasEvent(mx, canvas);
    expect((await listCanvases(SESSION))[0]).toMatchObject({
      title: 'Plans v2',
      revisionId: '$v2',
    });
    // Element can remove one version from a message's edit history; the SDK then shows the one before.
    const surviving = request();
    timeline.push(surviving);
    await recordCanvasEvent(
      mx,
      new MatrixEvent({
        event_id: '$removal',
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts: '$v2',
      })
    );
    expect(await listCanvases(SESSION)).toEqual([
      expect.objectContaining({
        canvasId: '$canvas',
        title: 'Plans',
        revisionId: '$canvas',
        updatedTs: 1,
      }),
    ]);
  });

  describe('when the update a row shows is deleted while its canvas loads from the server', () => {
    const removal = (redacts: string) =>
      new MatrixEvent({
        event_id: `$removal-${redacts}`,
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts,
      });
    const start = async () => {
      const { mx, relations } = fixture();
      const canvas = request();
      canvas.makeReplaced(edit('Plans v2', { id: '$v2', ts: 7 }));
      await recordCanvasEvent(mx, canvas);
      let respond: () => void = () => undefined;
      relations.mockReturnValue(
        new Promise((resolve) => {
          respond = () => resolve({ originalEvent: request(), events: [] });
        })
      );
      const fallback = recordCanvasEvent(mx, removal('$v2'));
      await settle();
      return { mx, fallback, respond };
    };

    it('keeps a newer update that came in meanwhile', async () => {
      const { mx, fallback, respond } = await start();
      await recordCanvasEvent(mx, edit('Plans v3', { id: '$v3', ts: 9 }));
      respond();
      await fallback;
      expect((await listCanvases(SESSION))[0]).toMatchObject({
        title: 'Plans v3',
        revisionId: '$v3',
      });
    });

    it('does not bring back a canvas deleted meanwhile', async () => {
      const { mx, fallback, respond } = await start();
      await recordCanvasEvent(mx, removal('$canvas'));
      respond();
      await fallback;
      expect(await listCanvases(SESSION)).toEqual([]);
    });
  });

  it('applies an update that arrives without its request, from the canvas agent only', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request());
    await recordCanvasEvent(mx, edit('Forged', { id: '$forged', ts: 9, sender: '@m:example.org' }));
    // The panel ignores an update that changes what the request is; so does the list.
    await recordCanvasEvent(
      mx,
      edit('Moved', { id: '$moved', ts: 4, extra: { thread_id: '$elsewhere' } })
    );
    expect((await listCanvases(SESSION))[0]).toMatchObject({ title: 'Plans', updatedTs: 1 });
    await recordCanvasEvent(mx, edit('Plans v2', { ts: 5 }));
    expect((await listCanvases(SESSION))[0]).toMatchObject({ title: 'Plans v2', updatedTs: 5 });
  });
});

describe('recordCanvasEvent for the computer', () => {
  it('records a show_computer notice made for this user', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, computerNotice());
    expect(await isComputerShown(SESSION, ROOM_ID, '$thread')).toBe(true);
    expect(await isComputerShown(SESSION, ROOM_ID, undefined)).toBe(false);
    await recordCanvasEvent(mx, computerNotice({ id: '$room-level', thread: null }));
    expect(await isComputerShown(SESSION, ROOM_ID, undefined)).toBe(true);
    expect(await listCanvases(SESSION)).toEqual([]);
  });

  it('ignores show_computer notices for other users or from non-agents', async () => {
    const { mx } = fixture();
    expect(
      recordCanvasEvent(mx, computerNotice({ extra: { requester_id: '@bob:example.org' } }))
    ).toBeUndefined();
    expect(recordCanvasEvent(mx, computerNotice({ sender: '@bob:example.org' }))).toBeUndefined();
    const echo = computerNotice();
    echo.setStatus('sending' as never);
    expect(recordCanvasEvent(mx, echo)).toBeUndefined();
    expect(await isComputerShown(SESSION, ROOM_ID, '$thread')).toBe(false);
  });
});

describe('conversation hooks', () => {
  const mountHook = <T,>(hook: () => T) => {
    const result: { current?: T } = {};
    // React may call a component once more before it bails out of an unchanged state; only commits count.
    let commits = 0;
    function Probe() {
      result.current = hook();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() =>
      root.render(
        <Profiler
          id="probe"
          onRender={() => {
            commits += 1;
          }}
        >
          <Probe />
        </Profiler>
      )
    );
    return { result, commits: () => commits, unmount: () => act(() => root.unmount()) };
  };
  // Reads follow writes after a 100 ms debounce; each poll waits inside `act` for the state updates they make.
  const waitFor = (assertion: () => void) =>
    vi.waitFor(async () => {
      await act(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 150);
          })
      );
      assertion();
    });

  it('useConversationCanvases lists only this conversation, newest update first', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request({ id: '$a', ts: 1 }));
    await recordCanvasEvent(mx, request({ id: '$b', ts: 2 }));
    await recordCanvasEvent(mx, request({ id: '$room', ts: 3, thread: null }));
    await recordCanvas(SESSION, {
      canvasId: '$elsewhere',
      roomId: '!other:example.org',
      threadId: '$thread',
      agentUserId: AGENT,
      title: 'Elsewhere',
      revisionId: '$elsewhere',
      createdTs: 4,
      updatedTs: 4,
      shared: false,
    });
    const thread = mountHook(() => useConversationCanvases(mx, ROOM_ID, '$thread'));
    const main = mountHook(() => useConversationCanvases(mx, ROOM_ID, undefined));
    const ids = (entries?: { canvasId: string }[]) => entries?.map((entry) => entry.canvasId);
    await waitFor(() => expect(ids(thread.result.current)).toEqual(['$b', '$a']));
    expect(ids(main.result.current)).toEqual(['$room']);
    await recordCanvasEvent(mx, edit('Plans v2', { id: '$a-v2', of: '$a', ts: 9 }));
    await waitFor(() => expect(ids(thread.result.current)).toEqual(['$a', '$b']));
    thread.unmount();
    main.unmount();
  });

  it('useComputerShown turns true when a notice is recorded', async () => {
    const { mx } = fixture();
    const shown = mountHook(() => useComputerShown(mx, ROOM_ID, '$thread'));
    const other = mountHook(() => useComputerShown(mx, ROOM_ID, undefined));
    await act(settle);
    expect(shown.result.current).toBe(false);
    await recordCanvasEvent(mx, computerNotice());
    await waitFor(() => expect(shown.result.current).toBe(true));
    expect(other.result.current).toBe(false);
    shown.unmount();
    other.unmount();
  });

  it('commits again only when the answer changes, not for other writes to the index', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request({ id: '$a', ts: 1 }));
    const canvases = mountHook(() => useConversationCanvases(mx, ROOM_ID, '$thread'));
    const shown = mountHook(() => useComputerShown(mx, ROOM_ID, '$thread'));
    await waitFor(() => expect(canvases.result.current).toHaveLength(1));
    const held = canvases.result.current;
    // The same canvas again and a canvas elsewhere write the index but leave both answers as they were.
    const writeElsewhere = async () => {
      await recordCanvasEvent(mx, request({ id: '$a', ts: 1 }));
      await recordCanvas(SESSION, {
        canvasId: '$elsewhere',
        roomId: '!other:example.org',
        agentUserId: AGENT,
        title: 'Elsewhere',
        revisionId: '$elsewhere',
        createdTs: 4,
        updatedTs: 4,
        shared: false,
      });
      await act(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 300);
          })
      );
    };
    // React renders a component once more before it bails out of the first unchanged state.
    await writeElsewhere();
    const committed = [canvases.commits(), shown.commits()];
    await writeElsewhere();
    expect([canvases.commits(), shown.commits()]).toEqual(committed);
    expect(canvases.result.current).toBe(held);
    // A change here still comes through.
    await recordCanvasEvent(mx, request({ id: '$b', ts: 2 }));
    await waitFor(() => expect(canvases.result.current).toHaveLength(2));
    canvases.unmount();
    shown.unmount();
  });

  it('useHasListedCanvases follows the list and a remount starts from the last answer', async () => {
    const { mx } = fixture();
    const first = mountHook(() => useHasListedCanvases(mx));
    await act(settle);
    expect(first.result.current).toBe(false);
    await recordCanvasEvent(mx, request());
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();
    const again = mountHook(() => useHasListedCanvases(mx));
    expect(again.result.current).toBe(true);
    again.unmount();
  });
});

describe('useCanvasIndexRecorder', () => {
  const mount = (mx: MatrixClient, enabled: boolean) => {
    function Recorder() {
      useCanvasIndexRecorder(mx, enabled);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Recorder />));
    return root;
  };

  it('lists canvases loaded before it started and those that arrive later', async () => {
    const { mx, timeline } = fixture();
    timeline.push(request());
    const root = mount(mx, true);
    await settle();
    expect((await listCanvases(SESSION)).map((listed) => listed.canvasId)).toEqual(['$canvas']);
    mx.emit(RoomEvent.Timeline, request({ id: '$later', ts: 3 }));
    mx.emit(MatrixEventEvent.Decrypted, request({ id: '$decrypted', ts: 4 }));
    await settle();
    expect((await listCanvases(SESSION)).map((listed) => listed.canvasId).sort()).toEqual([
      '$canvas',
      '$decrypted',
      '$later',
    ]);
    // An update whose request is not in memory reaches no timeline; sync still reports it.
    mx.emit(ClientEvent.Event, edit('Plans v2', { ts: 5 }));
    await settle();
    expect(
      (await listCanvases(SESSION)).find((listed) => listed.canvasId === '$canvas')
    ).toMatchObject({ title: 'Plans v2', updatedTs: 5 });
    act(() => root.unmount());
  });

  it('forgets a deleted canvas, also when its request is not in memory', async () => {
    const { mx, timeline } = fixture();
    timeline.push(request());
    const root = mount(mx, true);
    await settle();
    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({
        event_id: '$redaction',
        sender: AGENT,
        type: 'm.room.redaction',
        redacts: '$canvas',
        content: {},
      })
    );
    await settle();
    expect(await listCanvases(SESSION)).toEqual([]);
    act(() => root.unmount());
  });

  it('records nothing while canvases are off', async () => {
    const { mx, timeline } = fixture();
    timeline.push(request());
    const root = mount(mx, false);
    mx.emit(RoomEvent.Timeline, request({ id: '$later' }));
    await settle();
    expect(await listCanvases(SESSION)).toEqual([]);
    act(() => root.unmount());
  });
});

describe('loadCanvasEvent', () => {
  it('returns the loaded copy without asking the server', async () => {
    const { mx, room, timeline, relations } = fixture();
    const canvas = request();
    timeline.push(canvas);
    expect(await loadCanvasEvent(mx, room, '$canvas')).toBe(canvas);
    expect(relations).not.toHaveBeenCalled();
  });

  it('fetches a canvas from the server at its newest valid update', async () => {
    const { mx, room, relations } = fixture();
    relations.mockResolvedValue({
      originalEvent: request(),
      events: [
        edit('Plans v3', { id: '$v3', ts: 5 }),
        edit('Plans v2', { id: '$v2', ts: 3 }),
        // The SDK keeps only the request sender's edits, but an invalid one is skipped too.
        new MatrixEvent({
          event_id: '$bad',
          room_id: ROOM_ID,
          sender: AGENT,
          type: 'm.room.message',
          origin_server_ts: 9,
          content: {
            msgtype: 'm.notice',
            body: '* broken',
            'm.new_content': { msgtype: 'm.notice', body: 'broken' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas' },
          },
        }),
      ],
    });
    const loaded = await loadCanvasEvent(mx, room, '$canvas');
    expect(loaded?.replacingEventId()).toBe('$v3');
    expect(relations).toHaveBeenCalledWith(
      ROOM_ID,
      '$canvas',
      'm.replace',
      'm.room.message',
      expect.objectContaining({ dir: 'b' })
    );
  });

  it('returns nothing when the server cannot provide it', async () => {
    const { mx, room, relations } = fixture();
    relations.mockRejectedValueOnce(new Error('M_NOT_FOUND'));
    expect(await loadCanvasEvent(mx, room, '$canvas')).toBeUndefined();
    relations.mockResolvedValueOnce({ originalEvent: null, events: [] });
    expect(await loadCanvasEvent(mx, room, '$canvas')).toBeUndefined();
  });
});

describe('useOpenCanvasById', () => {
  const mountOpener = (
    mx: MatrixClient,
    room: Room,
    activate: (event: MatrixEvent) => void,
    conversation = 'thread A'
  ) => {
    const opener: { open?: (canvasId: string) => void } = {};
    function Probe({
      conversation: shown,
      onActivate,
    }: {
      conversation: string;
      onActivate: typeof activate;
    }) {
      opener.open = useOpenCanvasById(mx, room, shown, onActivate);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe conversation={conversation} onActivate={activate} />));
    return {
      open: (canvasId: string) => act(async () => opener.open!(canvasId)),
      show: (next: string, onActivate = activate) =>
        act(() => root.render(<Probe conversation={next} onActivate={onActivate} />)),
      unmount: () => act(() => root.unmount()),
    };
  };
  const deferredRelations = (relations: ReturnType<typeof vi.fn>) => {
    const pending: Array<(found: { originalEvent: MatrixEvent | null; events: [] }) => void> = [];
    relations.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        })
    );
    return pending;
  };

  it('hands the loaded request to the opener', async () => {
    const { mx, room, timeline } = fixture();
    const canvas = request();
    timeline.push(canvas);
    const activate = vi.fn();
    const opener = mountOpener(mx, room, activate);
    await opener.open('$canvas');
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(canvas);
    opener.unmount();
  });

  it('opens nothing and throws nothing when the request was deleted', async () => {
    const { mx, room, relations } = fixture();
    const activate = vi.fn();
    const opener = mountOpener(mx, room, activate);
    relations.mockResolvedValueOnce({ originalEvent: null, events: [] });
    await opener.open('$canvas');
    relations.mockRejectedValueOnce(new Error('M_NOT_FOUND'));
    await opener.open('$canvas');
    expect(activate).not.toHaveBeenCalled();
    opener.unmount();
  });

  it('opens a fetched request in the conversation it was chosen in', async () => {
    const { mx, room, relations } = fixture();
    const pending = deferredRelations(relations);
    const activate = vi.fn();
    const opener = mountOpener(mx, room, activate);
    await opener.open('$canvas');
    expect(activate).not.toHaveBeenCalled();
    const canvas = request();
    await act(async () => pending[0]({ originalEvent: canvas, events: [] }));
    expect(activate).toHaveBeenCalledWith(canvas);
    opener.unmount();
  });

  it('drops a fetched request when another conversation is shown by the time it arrives', async () => {
    const { mx, room, relations } = fixture();
    const pending = deferredRelations(relations);
    const activate = vi.fn();
    const opener = mountOpener(mx, room, activate);
    await opener.open('$canvas');
    await opener.show('thread B');
    await act(async () => pending[0]({ originalEvent: request(), events: [] }));
    expect(activate).not.toHaveBeenCalled();
    // A choice made in the new conversation opens there.
    await opener.open('$canvas');
    const canvas = request();
    await act(async () => pending[1]({ originalEvent: canvas, events: [] }));
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(canvas);
    opener.unmount();
  });

  it('drops a fetched request when the room left before it arrived', async () => {
    const { mx, room, relations } = fixture();
    const pending = deferredRelations(relations);
    const activate = vi.fn();
    const opener = mountOpener(mx, room, activate);
    await opener.open('$canvas');
    opener.unmount();
    await act(async () => pending[0]({ originalEvent: request(), events: [] }));
    expect(activate).not.toHaveBeenCalled();
  });

  it('lets a later choice win over an earlier, slower fetch', async () => {
    const { mx, room, relations } = fixture();
    const pending = deferredRelations(relations);
    const activate = vi.fn();
    const opener = mountOpener(mx, room, activate);
    await opener.open('$slow');
    await opener.open('$fast');
    const fast = request({ id: '$fast' });
    await act(async () => pending[1]({ originalEvent: fast, events: [] }));
    await act(async () => pending[0]({ originalEvent: request({ id: '$slow' }), events: [] }));
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(fast);
    opener.unmount();
  });

  it('acts through the latest opener', async () => {
    const { mx, room, relations } = fixture();
    const pending = deferredRelations(relations);
    const first = vi.fn();
    const second = vi.fn();
    const opener = mountOpener(mx, room, first);
    await opener.open('$canvas');
    await opener.show('thread A', second);
    const canvas = request();
    await act(async () => pending[0]({ originalEvent: canvas, events: [] }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(canvas);
    opener.unmount();
  });
});
