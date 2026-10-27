import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureTimelineBulkExpansionAnchor,
  restoreTimelineBulkExpansionAnchor,
} from './useTimelineBulkExpansionAnchor';

type FakeMessage = {
  dataset: { messageId: string };
  getBoundingClientRect: () => DOMRect;
};

const rect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    height: bottom - top,
  } as DOMRect);

const makeScroller = ({
  clientHeight = 800,
  messages = [],
  scrollHeight = 5_000,
  scrollTop = 2_000,
}: {
  clientHeight?: number;
  messages?: FakeMessage[];
  scrollHeight?: number;
  scrollTop?: number;
} = {}): HTMLDivElement =>
  ({
    clientHeight,
    scrollHeight,
    scrollTop,
    getBoundingClientRect: () => rect(100, 900),
    querySelectorAll: () => messages,
  } as unknown as HTMLDivElement);

let scrollPaddingTop = 0;
beforeEach(() => {
  scrollPaddingTop = 0;
  vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: `${scrollPaddingTop}px` }));
});

describe('timeline bulk expansion anchor', () => {
  it('restores the same fully visible message after rows above it grow', () => {
    let anchorTop = 430;
    const scroller = makeScroller({
      messages: [
        {
          dataset: { messageId: '$above' },
          getBoundingClientRect: () => rect(140, 240),
        },
        {
          dataset: { messageId: '$anchor' },
          getBoundingClientRect: () => rect(anchorTop, anchorTop + 120),
        },
      ],
    });

    const anchor = captureTimelineBulkExpansionAnchor(scroller, 1);
    expect(anchor).toEqual({
      kind: 'message',
      generation: 1,
      messageId: '$anchor',
      top: 430,
    });

    anchorTop += 785;
    restoreTimelineBulkExpansionAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(2_785);
  });

  it('keeps a reader at the latest message when the baseline changes at the bottom', () => {
    const scroller = makeScroller({
      clientHeight: 800,
      scrollHeight: 5_000,
      scrollTop: 4_190,
    });
    const anchor = captureTimelineBulkExpansionAnchor(scroller, 2);
    expect(anchor).toEqual({ kind: 'bottom', generation: 2 });

    Object.defineProperty(scroller, 'scrollHeight', { value: 8_000 });
    restoreTimelineBulkExpansionAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(7_200);
  });

  it('anchors a partially visible message when one message fills the viewport', () => {
    let messageTop = -500;
    const scroller = makeScroller({
      messages: [
        {
          dataset: { messageId: '$tall' },
          getBoundingClientRect: () => rect(messageTop, messageTop + 1_500),
        },
      ],
    });

    const anchor = captureTimelineBulkExpansionAnchor(scroller, 3);
    expect(anchor).toEqual({
      kind: 'message',
      generation: 3,
      messageId: '$tall',
      top: 108,
    });

    messageTop = 430;
    restoreTimelineBulkExpansionAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(2_322);
  });

  it('restores a message that fills the viewport below the sticky headers', () => {
    // The thread header and banner cover the top 150px of the scroller.
    scrollPaddingTop = 150;
    let messageTop = -500;
    const scroller = makeScroller({
      messages: [
        {
          dataset: { messageId: '$tall' },
          getBoundingClientRect: () => rect(messageTop, messageTop + 1_500),
        },
      ],
    });

    const anchor = captureTimelineBulkExpansionAnchor(scroller, 4);
    expect(anchor).toMatchObject({ messageId: '$tall', top: 258 });

    messageTop = 430;
    restoreTimelineBulkExpansionAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(2_172);
  });

  it('does not anchor a message whose top is under the sticky headers', () => {
    scrollPaddingTop = 150;
    const scroller = makeScroller({
      messages: [
        {
          dataset: { messageId: '$under' },
          getBoundingClientRect: () => rect(220, 320),
        },
        {
          dataset: { messageId: '$tall' },
          getBoundingClientRect: () => rect(330, 2_000),
        },
      ],
    });

    expect(captureTimelineBulkExpansionAnchor(scroller, 5)).toMatchObject({
      messageId: '$tall',
      top: 330,
    });
  });
});
