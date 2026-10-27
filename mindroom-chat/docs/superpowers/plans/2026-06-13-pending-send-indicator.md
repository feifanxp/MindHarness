# Pending Send Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a subtle inline clock indicator while a Matrix message is still a pending local echo.

**Architecture:** Add a fork-owned pending-send helper/component under `src/app/mindroom/messages/`, compose it with the existing message state suffix path, and pass a `pendingSend` boolean from `MindroomRoomTimeline` using Matrix local echo status. Keep the status helper in a CSS-free module so timeline code does not import the React indicator styles. Add a focused room local-echo refresh hook so `RoomEvent.LocalEchoUpdated` forces the timeline surfaces to re-render when the SDK mutates local echo status or replaces local IDs.

**Tech Stack:** React, TypeScript, Folds icons, matrix-js-sdk `EventStatus`, Vitest/react-test-renderer, vanilla-extract.

---

### Task 1: Pending Send Helper And Indicator

**Files:**

- Create: `src/app/mindroom/messages/pendingSendIndicator.tsx`
- Create: `src/app/mindroom/messages/pendingLocalEcho.ts`
- Create: `src/app/mindroom/messages/PendingSendIndicator.css.ts`
- Test: `src/app/mindroom/messages/pendingSendIndicator.test.ts`

- [x] **Step 1: Write the failing helper/component tests**

```tsx
it.each([EventStatus.ENCRYPTING, EventStatus.SENDING, EventStatus.QUEUED, EventStatus.SENT])(
  'treats %s as pending',
  (status) => {
    expect(isPendingLocalEchoStatus(status)).toBe(true);
  }
);

it.each([undefined, null, EventStatus.NOT_SENT, EventStatus.CANCELLED])(
  'does not treat %s as pending',
  (status) => {
    expect(isPendingLocalEchoStatus(status)).toBe(false);
  }
);

it('renders an accessible muted clock indicator', () => {
  const renderer = create(<PendingSendIndicator />);
  expect(JSON.stringify(renderer.toJSON())).toContain('Message sending');
  expect(JSON.stringify(renderer.toJSON())).toContain('Waiting for server');
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/app/mindroom/messages/pendingSendIndicator.test.ts`

Expected: FAIL because the helper/component files do not exist yet.

- [x] **Step 3: Implement the helper and indicator**

Implement:

- `isPendingLocalEchoStatus(status: unknown): boolean`
- `isPendingLocalEchoEvent(event?: Pick<MatrixEvent, 'status'> | null): boolean`
- `PendingSendIndicator`
- `renderPendingSendIndicator`

Use Folds `Icons.Clock`, a low-priority `Text` wrapper, `role="status"`,
`aria-label="Message sending"`, and `title="Waiting for server"`.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/app/mindroom/messages/pendingSendIndicator.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/app/mindroom/messages/pendingLocalEcho.ts src/app/mindroom/messages/pendingSendIndicator.tsx src/app/mindroom/messages/PendingSendIndicator.css.ts src/app/mindroom/messages/pendingSendIndicator.test.ts
git commit -m "feat: add pending send indicator"
```

### Task 2: Compose Message State Suffixes

**Files:**

- Create: `src/app/mindroom/messages/messageStateSuffix.tsx`
- Test: `src/app/mindroom/messages/messageStateSuffix.test.ts`
- Modify: `src/app/components/RenderMessageContent.tsx`
- Modify: `src/app/mindroom/messages/renderMindroomMessageContent.tsx`
- Test: `src/app/mindroom/messages/renderMindroomMessageContent.test.ts`

- [x] **Step 1: Write failing suffix composition tests**

Cover:

- no custom suffix and no pending returns `undefined`, preserving existing edited behavior,
- pending returns a suffix renderer,
- custom streaming suffix plus pending renders both,
- edited plus pending renders both edited and pending.
- custom suffix plus edited plus pending renders all three in order.

- [x] **Step 2: Run the focused tests and verify they fail**

Run:
`npm test -- src/app/mindroom/messages/messageStateSuffix.test.ts src/app/mindroom/messages/renderMindroomMessageContent.test.ts`

Expected: FAIL because the suffix helper does not exist and pending state is not passed.

- [x] **Step 3: Implement suffix composition**

Create `getMindroomMessageStateSuffixRenderer({ edited, pendingSend, renderStateSuffix })`.

Rules:

- return `undefined` when only `edited` is true, so current generic edited rendering remains unchanged,
- when a custom suffix or pending indicator exists, return a function that renders the custom suffix, then edited marker if needed, then pending indicator if needed,
- do not duplicate edited marker.

- [x] **Step 4: Add `pendingSend?: boolean` to `RenderMessageContent`**

Pass `pendingSend` through to `renderMindroomMessageContent`.

For local caption rendering in `RenderMessageContent`, pass a composed
`renderStateSuffix` to `MText` when `pendingSend` is true.

- [x] **Step 5: Add `pendingSend?: boolean` to `renderMindroomMessageContent`**

Use the composed suffix helper for text, notice, emote, and MindRoom long-text
rendering. Keep media-only and sticker rendering out of scope.

- [x] **Step 6: Run focused tests and verify they pass**

Run:
`npm test -- src/app/mindroom/messages/messageStateSuffix.test.ts src/app/mindroom/messages/renderMindroomMessageContent.test.ts src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/app/mindroom/messages/messageStateSuffix.tsx src/app/mindroom/messages/messageStateSuffix.test.ts src/app/components/RenderMessageContent.tsx src/app/mindroom/messages/renderMindroomMessageContent.tsx src/app/mindroom/messages/renderMindroomMessageContent.test.ts src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts
git commit -m "feat: compose pending message suffix"
```

### Task 3: Wire Pending State From Timeline Events

**Files:**

- Modify: `src/app/mindroom/threads/MindroomRoomTimeline.tsx`
- Test: `src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

- [x] **Step 1: Write a failing rendering test**

Add a focused source-architecture guard that requires `MindroomRoomTimeline.tsx`
to import `isPendingLocalEchoEvent`, derive pending state from both `mEvent` and
`editedEvent`, and pass that derived value to message content renderers.
Behavioral coverage for pending vs accepted/failed states lives in the focused
message renderer tests from Tasks 1 and 2.

- [x] **Step 2: Run the focused test and verify it fails**

Run:
`npm test -- src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

Expected: FAIL because `MindroomRoomTimeline.tsx` is not passing
`pendingSend`.

- [x] **Step 3: Wire the pending state**

Import `isPendingLocalEchoEvent` from the CSS-free pending local echo helper in
`MindroomRoomTimeline.tsx` and derive:

```tsx
const pendingSend = isPendingLocalEchoEvent(mEvent) || isPendingLocalEchoEvent(editedEvent);
```

Pass `pendingSend={pendingSend}` to `RenderMessageContent` call sites that render standard room messages,
encrypted room-message content after decryption, and MindRoom approval/text
content where the suffix path is used.

- [x] **Step 4: Run the focused test and verify it passes**

Run:
`npm test -- src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/app/mindroom/threads/MindroomRoomTimeline.tsx src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts
git commit -m "feat: show pending indicator for local echoes"
```

### Task 4: Refresh On Local Echo Status Updates

**Files:**

- Create: `src/app/mindroom/threads/roomLocalEchoRefresh.ts`
- Test: `src/app/mindroom/threads/roomLocalEchoRefresh.test.ts`
- Modify: `src/app/mindroom/threads/roomLiveEventController.ts`

- [x] **Step 1: Write failing hook tests**

Test that `useRoomLocalEchoRefresh(room, callback)` subscribes to
`RoomEvent.LocalEchoUpdated`, calls the callback for the same room, ignores
other rooms, and removes the listener on unmount.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/app/mindroom/threads/roomLocalEchoRefresh.test.ts`

Expected: FAIL because the hook does not exist.

- [x] **Step 3: Implement the hook**

Use `useEffect`, `RoomEvent.LocalEchoUpdated`, and
`RoomEventHandlerMap[RoomEvent.LocalEchoUpdated]`.

- [x] **Step 4: Use the hook in `useRoomLiveEventController`**

Call the hook with a memoized callback that does:

```ts
setTimeline((current) => ({ ...current }));
```

This is intentionally broad and cheap; local echo updates are low volume and
status/id replacement must refresh both room and thread surfaces.

- [x] **Step 5: Run focused tests and verify they pass**

Run:
`npm test -- src/app/mindroom/threads/roomLocalEchoRefresh.test.ts src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/app/mindroom/threads/roomLocalEchoRefresh.ts src/app/mindroom/threads/roomLocalEchoRefresh.test.ts src/app/mindroom/threads/roomLiveEventController.ts
git commit -m "fix: refresh room timeline on local echo updates"
```

### PR Follow-Up: Compact Overview Cards

**Files:**

- Modify: `src/app/mindroom/threads/threadRecord.ts`
- Modify: `src/app/mindroom/threads/compactThreadCardViewModel.ts`
- Modify: `src/app/mindroom/threads/types.ts`
- Modify: `src/app/mindroom/threads/CompactThreadCard.tsx`
- Modify: `src/app/mindroom/threads/CompactRoomView.css.ts`
- Test: `src/app/mindroom/threads/compactThreadCardViewModel.test.ts`
- Test: `src/app/mindroom/threads/CompactThreadCard.test.tsx`

- [x] **Step 1: Write failing compact view tests**

Cover:

- zero-reply thread root local echoes set `hasPendingSend`,
- pending visible reply local echoes set `hasPendingSend`,
- compact cards render the pending indicator beside preview text.

- [x] **Step 2: Run the compact tests and verify they fail**

Run:
`npm test -- src/app/mindroom/threads/CompactThreadCard.test.tsx src/app/mindroom/threads/compactThreadCardViewModel.test.ts`

Expected: FAIL because compact models do not expose pending send state and the
card does not render the indicator.

- [x] **Step 3: Implement compact pending state**

In `threadRecord.ts`, derive `hasPendingSend` from the resolved thread root and
loaded visible replies, checking both each event and its pending replacement
event with `isPendingLocalEchoEvent`.

In `compactThreadCardViewModel.ts`, map the thread-record status flag into the
compact card view model.

- [x] **Step 4: Render the indicator in compact cards**

Import `PendingSendIndicator` into `CompactThreadCard.tsx`, include
`Message sending` in the card aria label when pending, and render the clock next
to preview text inside a stable flex wrapper.

- [x] **Step 5: Run the compact tests and verify they pass**

Run:
`npm test -- src/app/mindroom/threads/CompactThreadCard.test.tsx src/app/mindroom/threads/compactThreadCardViewModel.test.ts`

Expected: PASS.

### PR Follow-Up: Open Thread Sends

**Files:**

- Modify: `src/app/mindroom/room-input/MindroomRoomInput.tsx`
- Modify: `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx`
- Modify: `src/app/mindroom/threads/roomLiveEventController.ts`
- Test: `src/app/mindroom/room-input/__tests__/RoomInput.test.ts`
- Test: `src/app/mindroom/threads/__tests__/RoomTimeline.cache.test.ts`

- [x] **Step 1: Write failing active-thread send tests**

Cover:

- the thread composer shows `Message sending` while an unresolved
  `sendMessage` promise is in flight,
- a pending thread reply local echo emitted with `liveEvent: false` is retained
  as a supplemental event for the open thread timeline.

- [x] **Step 2: Run the active-thread tests and verify they fail**

Run:
`npm test -- src/app/mindroom/room-input/__tests__/RoomInput.test.ts -t "pending send indicator for unresolved thread composer sends"`

Run:
`npm test -- src/app/mindroom/threads/__tests__/RoomTimeline.cache.test.ts -t "adds pending local-echo replies"`

Expected: FAIL while the composer context has no pending send state and the
live-event controller drops pending thread local echoes with `liveEvent: false`.

- [x] **Step 3: Implement active-thread pending state**

Track a narrow `submitPending` state around unresolved text-message
`mx.sendMessage` calls in `MindroomRoomInput.tsx`. Pass it to
`MindroomRoomInputReplyContext` only when composing inside an open thread.

In `RoomInputMindroomExtensions.tsx`, render `PendingSendIndicator` beside the
`Sending to this thread` context when `pendingSend` is true.

In `roomLiveEventController.ts`, keep pending thread reply local echoes emitted
with `liveEvent: false` as supplemental thread events instead of dropping them
before the open thread can render them.

- [x] **Step 4: Run the active-thread tests and verify they pass**

Run:
`npm test -- src/app/mindroom/room-input/__tests__/RoomInput.test.ts -t "pending send indicator for unresolved thread composer sends"`

Run:
`npm test -- src/app/mindroom/threads/__tests__/RoomTimeline.cache.test.ts -t "adds pending local-echo replies"`

Expected: PASS.

### Task 5: Final Validation And Runbook

**Files:**

- Modify: `FORK_CHANGES.md`

- [x] **Step 1: Update runbook status and files/validation notes**

Record changed files, design decisions, focused test results, and final
validation commands under `CINNY-132`.

- [x] **Step 2: Run focused validation**

Run:

```bash
npm test -- src/app/mindroom/messages/pendingSendIndicator.test.ts src/app/mindroom/messages/messageStateSuffix.test.ts src/app/mindroom/messages/renderMindroomMessageContent.test.ts src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts src/app/mindroom/threads/roomLocalEchoRefresh.test.ts src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts
npm run typecheck
npx prettier --check FORK_CHANGES.md docs/superpowers/specs/2026-06-13-pending-send-indicator-design.md docs/superpowers/plans/2026-06-13-pending-send-indicator.md src/app/mindroom/messages/pendingLocalEcho.ts src/app/mindroom/messages/pendingSendIndicator.tsx src/app/mindroom/messages/PendingSendIndicator.css.ts src/app/mindroom/messages/messageStateSuffix.tsx src/app/components/RenderMessageContent.tsx src/app/mindroom/messages/renderMindroomMessageContent.tsx src/app/mindroom/threads/roomLocalEchoRefresh.ts src/app/mindroom/threads/roomLiveEventController.ts
git diff --check
```

- [x] **Step 3: Run broader validation**

Run `npm test`, `npm run lint`, and `npm run build`. Treat `npm test` as
required by `AGENTS.md` unless the environment prevents completion; if blocked,
record the concrete reason in `FORK_CHANGES.md`. Record any existing
warning-only baselines.

- [x] **Step 4: Commit runbook and plan**

```bash
git add FORK_CHANGES.md docs/superpowers/plans/2026-06-13-pending-send-indicator.md
git commit -m "docs: record pending send indicator validation"
```
