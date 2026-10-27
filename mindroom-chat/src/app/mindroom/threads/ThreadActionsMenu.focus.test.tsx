// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type FocusTrap from 'focus-trap-react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadActionsMenu } from './ThreadActionsMenu';

vi.mock('./ThreadContextBanner.css', () => ({
  TagPickerInput: 'input',
  TagPickerInputContainer: 'container',
}));
vi.mock('../../styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));

const state = vi.hoisted(() => ({
  updatingTags: false,
  save: vi.fn(),
  regenerate: vi.fn(),
}));
vi.mock('./useThreadTags', () => ({
  useThreadTags: () => ({
    displayTags: ['triage'],
    availableTags: ['urgent'],
    canEdit: true,
    isResolved: false,
  }),
}));
vi.mock('./useMutateThreadTags', () => ({
  useMutateThreadTags: () => ({ updating: state.updatingTags }),
}));
vi.mock('./useThreadPinning', () => ({
  useThreadPinning: () => ({ pinnedEventIds: [], canPin: false, updating: false }),
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:test' }),
}));
vi.mock('../../hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../hooks/useRoomMembers', () => ({
  useRoomMembers: () => [{ userId: '@mindroom_helper:test', name: 'Helper', membership: 'join' }],
}));
vi.mock('./threadSummaryActions', async (original) => ({
  ...(await original<typeof import('./threadSummaryActions')>()),
  saveThreadSummary: state.save,
  requestThreadSummary: state.regenerate,
}));
vi.mock('focus-trap-react', async (original) => {
  const { default: RealFocusTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealFocusTrap
        {...props}
        focusTrapOptions={{
          ...focusTrapOptions,
          delayInitialFocus: false,
          // JSDOM has no layout; retain the real keyboard and focus behavior.
          tabbableOptions: { displayCheck: 'none' },
        }}
      />
    ),
  };
});
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content, anchor }: { content: React.ReactNode; anchor: unknown }) =>
    anchor ? content : null,
  Overlay: ({ children }: { children: React.ReactNode }) => children,
}));

const rootEvent = new MatrixEvent({
  event_id: '$root',
  room_id: '!room:test',
  type: 'm.room.message',
  sender: '@me:test',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'Thread root' },
});
const room = {
  roomId: '!room:test',
  getMyMembership: () => 'join',
  getThread: () => undefined,
  findEventById: () => rootEvent,
  currentState: { maySendEvent: () => true },
} as unknown as Room;

describe('ThreadActionsMenu focus while saving', () => {
  let root: Root;
  let host: HTMLDivElement;
  let errors: unknown[];
  const captureError = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  const renderMenu = () =>
    root.render(
      <ThreadActionsMenu
        room={room}
        rootId="$root"
        summaryText="Saved summary"
        anchor={{ x: 1, y: 1, width: 1, height: 1 }}
        onClose={() => undefined}
      />
    );
  const openDialog = (action: string) => {
    act(renderMenu);
    act(() => {
      host.querySelector<HTMLButtonElement>(`[data-thread-action="${action}"]`)!.click();
    });
  };
  const pressTab = (shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(event);
    expect(errors).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    state.updatingTags = false;
    errors = [];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    window.addEventListener('error', captureError);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.removeEventListener('error', captureError);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(['editSummary', 'regenerate'] as const)(
    'keeps focus inside the %s dialog until its request finishes',
    async (action) => {
      let finish: () => void = () => undefined;
      const request = new Promise<void>((resolve) => {
        finish = resolve;
      });
      (action === 'editSummary' ? state.save : state.regenerate).mockReturnValue(request);
      openDialog(action);
      act(() => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      expect(
        host.querySelectorAll(
          'button:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
        )
      ).toHaveLength(0);

      pressTab();
      pressTab(true);

      await act(async () => finish());
      expect(host.querySelectorAll('button:not(:disabled)').length).toBeGreaterThan(0);
    }
  );

  it('keeps focus inside the tag dialog while all mutation controls are disabled', () => {
    openDialog('tags');
    state.updatingTags = true;
    act(renderMenu);
    expect(host.querySelectorAll('button:not(:disabled)')).toHaveLength(0);

    pressTab();
    pressTab(true);

    state.updatingTags = false;
    act(renderMenu);
    expect(host.querySelectorAll('button:not(:disabled)').length).toBeGreaterThan(0);
  });
});
