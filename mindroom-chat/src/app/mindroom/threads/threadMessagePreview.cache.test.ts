import { type TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalizedThreadMessagePreviewText,
  getThreadMessagePreviewText,
} from './threadMessagePreview';

const { trimReplyFromBody } = vi.hoisted(() => ({
  trimReplyFromBody: vi.fn((body: string) => body),
}));

vi.mock('../../utils/room', () => ({ trimReplyFromBody }));

const textContent = (body: string): Record<string, unknown> => ({ msgtype: 'm.text', body });
const t = ((key: string, options?: { count?: number }) =>
  `${key}:${options?.count ?? ''}`) as unknown as TFunction;

describe('thread message preview analysis reuse', () => {
  beforeEach(() => {
    trimReplyFromBody.mockClear();
  });

  it('analyzes a body once across preview and localization passes', () => {
    const body = '🔧 `shell` [1]\n**Pruned** the images and freed 12 GB.';

    const first = getLocalizedThreadMessagePreviewText(textContent(body), t);
    const second = getLocalizedThreadMessagePreviewText(textContent(body), t);

    expect(first).toBe('🔧 sharedUi.threadPreviews.tools:1 · Pruned the images and freed 12 GB.');
    expect(second).toBe(first);
    expect(getThreadMessagePreviewText(textContent(body))).toBe(
      '🔧 1 tool · Pruned the images and freed 12 GB.'
    );
    expect(trimReplyFromBody).toHaveBeenCalledTimes(1);
  });

  it('analyzes each distinct body, such as successive streamed edits', () => {
    expect(getThreadMessagePreviewText(textContent('Streaming reply part one'))).toBe(
      'Streaming reply part one'
    );
    expect(getThreadMessagePreviewText(textContent('Streaming reply part one and two'))).toBe(
      'Streaming reply part one and two'
    );
    expect(trimReplyFromBody).toHaveBeenCalledTimes(2);
  });

  it('keeps analyses for a large room working set across rebuilds', () => {
    // Two previews per thread for a room with 523 threads, then a rebuild.
    const bodies = Array.from({ length: 1_100 }, (_, index) => `Thread message ${index}`);
    bodies.forEach((body) => getThreadMessagePreviewText(textContent(body)));
    trimReplyFromBody.mockClear();

    bodies.forEach((body) => getThreadMessagePreviewText(textContent(body)));

    expect(trimReplyFromBody).not.toHaveBeenCalled();
  });

  it('evicts the least recently read body beyond the entry limit', () => {
    const bodies = Array.from({ length: 5_000 }, (_, index) => `Entry limit body ${index}`);
    bodies.forEach((body) => getThreadMessagePreviewText(textContent(body)));
    // Reading the oldest body makes the second oldest the next to go.
    getThreadMessagePreviewText(textContent(bodies[0]));
    getThreadMessagePreviewText(textContent('Entry limit overflow'));
    trimReplyFromBody.mockClear();

    getThreadMessagePreviewText(textContent(bodies[0]));
    expect(trimReplyFromBody).not.toHaveBeenCalled();
    getThreadMessagePreviewText(textContent(bodies[1]));
    expect(trimReplyFromBody).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest bodies beyond the character budget', () => {
    // 67 bodies of 60,000 characters exceed the 4 million character budget.
    const bodies = Array.from(
      { length: 67 },
      (_, index) => `Budget body ${String(index).padStart(2, '0')} ${'y'.repeat(60_000)}`
    );
    bodies.forEach((body) => getThreadMessagePreviewText(textContent(body)));
    trimReplyFromBody.mockClear();

    getThreadMessagePreviewText(textContent(bodies[66]));
    expect(trimReplyFromBody).not.toHaveBeenCalled();
    getThreadMessagePreviewText(textContent(bodies[0]));
    expect(trimReplyFromBody).toHaveBeenCalledTimes(1);
  });
});
