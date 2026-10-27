// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent, RoomEvent, SyncState } from 'matrix-js-sdk';
import {
  ChatUiActionContext,
  useChatUiActions,
  type ChatUiActionOptions,
} from './ChatUiActionProvider';
import { ChatUiActionButton } from './ChatUiActionButton';
import { makeUiEvent, makeUiRoom } from './testUtils';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('folds', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: React.PropsWithChildren<{ disabled?: boolean; onClick?: () => void }>) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Text: ({ children, role }: React.PropsWithChildren<{ role?: string }>) => (
    <span role={role}>{children}</span>
  ),
  Box: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Icon: () => null,
  Icons: {},
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options: { defaultValue?: string }) => options?.defaultValue,
  }),
}));

type HarnessProps = React.PropsWithChildren<ChatUiActionOptions>;
function Harness({ children, ...options }: HarnessProps) {
  const actions = useChatUiActions(options);
  return <ChatUiActionContext.Provider value={actions}>{children}</ChatUiActionContext.Provider>;
}

describe('Chat UI request buttons', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const setup = (event = makeUiEvent()) => {
    const { mx, room } = makeUiRoom();
    vi.spyOn(mx, 'isInitialSyncComplete').mockReturnValue(true);
    vi.spyOn(mx, 'getSyncState').mockReturnValue(SyncState.Syncing);
    const perform = vi.fn();
    const navigate = vi.fn();
    let props: HarnessProps = {
      mx,
      room,
      threadId: '$thread',
      autoOpenFromHomeservers: ['example.org'],
      ready: true,
      perform,
      navigate,
      unavailable: () => undefined,
      children: <ChatUiActionButton event={event} />,
    };
    const render = (overrides: Partial<HarnessProps> = {}) => {
      props = { ...props, ...overrides };
      act(() =>
        root.render(
          <React.Suspense fallback={<span>Loading</span>}>
            <Harness {...props} />
          </React.Suspense>
        )
      );
    };
    render();
    return { mx, room, perform, navigate, render };
  };

  it('renders history passively, then opens it on an explicit click', async () => {
    const { perform } = setup();
    expect(perform).not.toHaveBeenCalled();
    expect(container.textContent).toContain('View computer');
    await act(async () => container.querySelector('button')!.click());
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ action: 'show_computer' }));
  });

  it('routes a historical button to its own thread before executing', async () => {
    const { perform, navigate, render } = setup();
    render({ threadId: '$another' });
    await act(async () => container.querySelector('button')!.click());
    expect(navigate).toHaveBeenCalledWith('$thread');
    expect(perform).not.toHaveBeenCalled();
    render({ threadId: '$thread' });
    expect(perform).toHaveBeenCalledTimes(1);
    render();
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('revalidates membership at click time instead of trusting previously rendered content', async () => {
    const { room, perform } = setup();
    room.currentState.setStateEvents([
      new MatrixEvent({
        event_id: '$left',
        type: 'm.room.member',
        room_id: room.roomId,
        sender: '@mindroom_helper:example.org',
        state_key: '@mindroom_helper:example.org',
        content: { membership: 'leave' },
      }),
    ]);
    await act(async () => container.querySelector('button')!.click());
    expect(perform).not.toHaveBeenCalled();
  });

  it('keeps an unavailable or human-controlled computer passive and explains why', () => {
    const { render, perform } = setup();
    render({ unavailable: () => 'Release computer control before opening another view.' });
    expect(container.querySelector('button')!.disabled).toBe(true);
    expect(container.textContent).toContain('Release computer control');
    expect(perform).not.toHaveBeenCalled();
  });

  it('never offers another user an action button', () => {
    setup(makeUiEvent({ requester_id: '@bob:example.org' }));
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps an unlisted homeserver passive while allowing the explicit button', async () => {
    const event = makeUiEvent();
    const { mx, room, perform, render } = setup(event);
    render({ autoOpenFromHomeservers: ['elsewhere.org'] });
    event.event.origin_server_ts = Date.now();
    act(() =>
      mx.emit(RoomEvent.Timeline, event, room, false, false, {
        liveEvent: true,
        timeline: room.getLiveTimeline(),
      })
    );
    expect(perform).not.toHaveBeenCalled();
    expect(container.querySelector('button')!.disabled).toBe(false);
    await act(async () => container.querySelector('button')!.click());
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ action: 'show_computer' }));
  });

  it('executes a fresh request once without executing the card during rerender', () => {
    const event = makeUiEvent({}, { origin_server_ts: Date.now() + 5 });
    const { mx, room, perform, render } = setup(event);
    event.event.origin_server_ts = Date.now();
    act(() =>
      mx.emit(RoomEvent.Timeline, event, room, false, false, {
        liveEvent: true,
        timeline: room.getLiveTimeline(),
      })
    );
    expect(perform).toHaveBeenCalledTimes(1);
    render();
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'uses committed callbacks while a replacement render suspends (blocked: %s)',
    async (blocked) => {
      const event = makeUiEvent();
      const { mx, room, perform, render } = setup(event);
      const uncommittedPerform = vi.fn();
      const suspended = new Promise<void>(() => {
        // Keep the replacement render suspended while the committed listener receives an event.
      });
      let attemptedReplacement = false;
      function Suspend(): never {
        attemptedReplacement = true;
        throw suspended;
      }
      await act(async () => {
        React.startTransition(() => {
          render({
            perform: uncommittedPerform,
            unavailable: () => (blocked ? 'Replacement view is blocked' : undefined),
            children: <Suspend />,
          });
        });
      });
      expect(attemptedReplacement).toBe(true);
      expect(container.textContent).toContain('View computer');
      event.event.origin_server_ts = Date.now();
      act(() =>
        mx.emit(RoomEvent.Timeline, event, room, false, false, {
          liveEvent: true,
          timeline: room.getLiveTimeline(),
        })
      );
      expect(perform).toHaveBeenCalledTimes(1);
      expect(uncommittedPerform).not.toHaveBeenCalled();
    }
  );
});
