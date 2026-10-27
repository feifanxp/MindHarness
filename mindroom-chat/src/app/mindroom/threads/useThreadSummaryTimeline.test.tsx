// @vitest-environment jsdom
import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useThreadSummaryTimeline } from './useThreadSummaryTimeline';
import type { ThreadSummaryTimelinePlan } from './threadSummaryTimeline';

const summaryContent = (text: string) => ({
  msgtype: 'm.notice',
  body: text,
  'io.mindroom.thread_summary': { version: 1, summary: text, message_count: 1 },
});
const summary = (id: string, text: string) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender: '@code:example.org',
    content: summaryContent(text),
  });

// Stands in for an event the SDK has not decrypted yet.
class EncryptedEvent extends EventEmitter {
  type = 'm.room.encrypted';

  content: Record<string, unknown> = { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' };

  status = null;

  constructor(private readonly id: string) {
    super();
  }

  getId = () => this.id;

  getType = () => this.type;

  getContent = () => this.content;

  getRelation = () => null;

  // The wire type stays encrypted after a failed attempt, as in the SDK.
  isEncrypted = () => true;

  failDecryption() {
    this.type = 'm.room.message';
    this.content = { msgtype: 'm.bad.encrypted', body: '** Unable to decrypt **' };
    this.emit(MatrixEventEvent.Decrypted, this);
  }

  decryptAs(content: Record<string, unknown>) {
    this.type = 'm.room.message';
    this.content = content;
    this.emit(MatrixEventEvent.Decrypted, this);
  }
}

const history = { sdkLoaded: true, canPaginateBack: false, hasMoreCachedBack: false };

const renderPlan = (initialEvents: readonly MatrixEvent[]) => {
  const plans: ThreadSummaryTimelinePlan[] = [];
  function Harness({ events }: { events: readonly MatrixEvent[] }) {
    plans.push(useThreadSummaryTimeline(events, { history }));
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness events={initialEvents} />);
  });
  const rerender = (events: readonly MatrixEvent[]) =>
    act(() => renderer.update(<Harness events={events} />));
  return { plans, renderer, rerender };
};

describe('useThreadSummaryTimeline', () => {
  it('plans a summary again once it decrypts', () => {
    const encrypted = new EncryptedEvent('$s2');
    const { plans, renderer } = renderPlan([
      summary('$s1', 'Push bug'),
      encrypted as unknown as MatrixEvent,
    ]);
    expect(plans.at(-1)!.hiddenEventIds.size).toBe(0);

    act(() => encrypted.decryptAs(summaryContent('Push bug')));

    expect([...plans.at(-1)!.hiddenEventIds]).toEqual(['$s2']);
    act(() => renderer.unmount());
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('plans a summary again when it decrypts after a failed attempt', () => {
    const encrypted = new EncryptedEvent('$s2');
    const events = [summary('$s1', 'Push bug'), encrypted as unknown as MatrixEvent];
    const { plans, renderer, rerender } = renderPlan(events);

    act(() => encrypted.failDecryption());
    // A later thread change, such as a new reply, gives the hook a new array.
    rerender([...events]);
    act(() => encrypted.decryptAs(summaryContent('Push bug')));

    expect([...plans.at(-1)!.hiddenEventIds]).toEqual(['$s2']);
    act(() => renderer.unmount());
  });
});
