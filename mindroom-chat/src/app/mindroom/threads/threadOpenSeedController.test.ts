import { describe, expect, it, vi } from 'vitest';
import { RelationType } from 'matrix-js-sdk';
import { makeEvent, makeRoom } from './test-utils/RoomTimeline.test.shared';
import { createThreadOpenSeedSession } from './threadOpenSeedController';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';

const makeRefs = (threadId = '$root') => ({
  seed: { waitForExistingOrQueued: vi.fn<() => Promise<void> | undefined>(() => undefined) },
  threadId,
});

describe('createThreadOpenSeedSession', () => {
  it('applies visible room thread events immediately for targeted opens', () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
    const edit = makeEvent('$edit', {
      associatedId: '$reply',
      relation: { rel_type: RelationType.Replace, event_id: '$reply' },
      threadRootId: '$root',
      ts: 3,
    });
    const room = makeRoom({ liveEvents: [root, reply, edit] });
    const supplemental = vi.fn();
    const refs = makeRefs();

    const session = createThreadOpenSeedSession({
      debugTraceId: 'test',
      ...refs,
      room: room as never,
      roomTimelineSet: room.getUnfilteredTimelineSet() as never,
      setSupplementalThreadEvents: supplemental,
      shouldScrollToLatestOnOpen: false,
    });

    expect(session.applyInitialRoomThreadSeed()).toBe(true);
    expect(supplemental).toHaveBeenCalledWith('$root', [root, reply]);
    expect(session.initialRoomThreadSeedEvents.map((event) => event.getId())).toEqual([
      '$root',
      '$reply',
      '$edit',
    ]);
  });

  it('merges cached memory, thread model seed, and room seed for untargeted opens', () => {
    const cached = makeEvent('$cached', { threadRootId: '$root', ts: 0 });
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
    const room = makeRoom({ liveEvents: [root, reply] });
    saveThreadOpenSeedSnapshot(room as never, '$root', [cached] as never);
    const supplemental = vi.fn();
    const refs = makeRefs();

    const session = createThreadOpenSeedSession({
      debugTraceId: 'test',
      ...refs,
      room: room as never,
      roomTimelineSet: room.getUnfilteredTimelineSet() as never,
      setSupplementalThreadEvents: supplemental,
      shouldScrollToLatestOnOpen: true,
    });

    session.startUntargetedSeedPrewarmWait(() => true);

    expect(supplemental).toHaveBeenCalledWith(
      '$root',
      expect.arrayContaining([cached, root, reply])
    );
    expect(session.initialThreadMemorySeedEvents).toEqual([cached]);
  });

  // CINNY-207 P7.2 audit finding #2 — `void p.finally(cb)` re-rejects.
  // When the thread-seed scheduler promise rejects (engine teardown
  // aborting a queued 'thread-seed' job), the .finally shape produced
  // a NEW rejected promise nothing handled; .then(cb, cb) runs the
  // fallback seed cleanup on both branches without a further rejection.
  it('does not surface an unhandled rejection when the awaited prewarm promise rejects', async () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const room = makeRoom({ liveEvents: [root] });
    const supplemental = vi.fn();
    const refs = makeRefs();
    // Pretend the prewarm is in-flight; the awaited promise below rejects.
    const rejection = new Error('backfill scheduler stopped');
    const rejected = Promise.reject(rejection);
    refs.seed.waitForExistingOrQueued.mockReturnValue(rejected);

    const unhandledReasons: unknown[] = [];
    const trackUnhandled = (event: PromiseRejectionEvent) => {
      unhandledReasons.push(event.reason);
    };
    // Node's harness exposes both the DOM event and the process event.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('unhandledrejection', trackUnhandled);
    }
    const processUnhandled = (reason: unknown) => {
      unhandledReasons.push(reason);
    };
    process.on('unhandledRejection', processUnhandled);

    try {
      const session = createThreadOpenSeedSession({
        debugTraceId: 'test',
        ...refs,
        room: room as never,
        roomTimelineSet: room.getUnfilteredTimelineSet() as never,
        setSupplementalThreadEvents: supplemental,
        shouldScrollToLatestOnOpen: true,
      });

      session.startUntargetedSeedPrewarmWait(() => true);

      // Let the rejection settle through the .then(cb, cb) handler.
      await rejected.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();

      expect(unhandledReasons).not.toContain(rejection);
    } finally {
      process.off('unhandledRejection', processUnhandled);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('unhandledrejection', trackUnhandled);
      }
    }
  });
});
