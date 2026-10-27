import { describe, expect, it, vi } from 'vitest';
import {
  planThreadLedgerRender,
  type ThreadLedgerAnchor,
  type ThreadLedgerEvent,
} from './threadScrollLedger';

const event = (eventId: string): ThreadLedgerEvent => ({ getId: () => eventId });
const events = (...ids: string[]) => ids.map(event);
const indexMap = (list: readonly ThreadLedgerEvent[]) =>
  new Map(list.map((item, index) => [item.getId()!, index]));

const anchorOn = (
  list: readonly ThreadLedgerEvent[],
  eventId: string,
  priceRow: ThreadLedgerAnchor['priceRow'] = () => 10
): ThreadLedgerAnchor => ({
  threadId: '$root',
  eventId,
  index: list.findIndex((item) => item.getId() === eventId),
  events: list,
  priceRow,
});

const plan = (
  anchor: ThreadLedgerAnchor | undefined,
  threadEvents: readonly ThreadLedgerEvent[],
  priceRow: (eventId: string, index: number) => number = () => 10
) =>
  planThreadLedgerRender({
    anchor,
    eventIndexMap: indexMap(threadEvents),
    priceRow,
    threadEvents,
    threadId: '$root',
  });

describe('planThreadLedgerRender', () => {
  it('folds nothing without a committed anchor or for the anchored list itself', () => {
    const list = events('$root', '$a', '$b');
    expect(plan(undefined, list)).toEqual({ foldPx: 0 });
    expect(plan(anchorOn(list, '$b'), list)).toEqual({ foldPx: 0 });
  });

  it('folds rows that land above the reader, whoever added them', () => {
    const previous = events('$root', '$a', '$reader', '$c');
    const next = events('$root', '$old1', '$old2', '$a', '$reader', '$c');
    const priceRow = vi.fn((eventId: string) => (eventId === '$old1' ? 30 : 50));

    expect(plan(anchorOn(previous, '$reader'), next, priceRow)).toEqual({ foldPx: 80 });
    expect(priceRow.mock.calls.map(([eventId]) => eventId)).toEqual(['$old1', '$old2']);
  });

  it('leaves rows that land below the reader, such as new replies and edits', () => {
    const previous = events('$root', '$a', '$reader');
    const next = events('$root', '$a', '$reader', '$edit', '$new');
    const priceRow = vi.fn(() => 10);

    expect(plan(anchorOn(previous, '$reader'), next, priceRow)).toEqual({ foldPx: 0 });
    expect(priceRow).not.toHaveBeenCalled();
  });

  it('keeps the root in place when the reader is looking at it', () => {
    const previous = events('$root', '$a');
    const next = events('$root', '$old', '$a');

    expect(plan(anchorOn(previous, '$root'), next)).toEqual({ foldPx: 0 });
  });

  it('prices a removed row above the reader with the list it was committed in', () => {
    const previous = events('$root', '$gone', '$a', '$reader');
    const next = events('$root', '$a', '$reader');
    const previousPrice = vi.fn((_eventId: string, index: number) => (index === 1 ? 70 : 0));

    expect(plan(anchorOn(previous, '$reader', previousPrice), next)).toEqual({ foldPx: -70 });
    expect(previousPrice).toHaveBeenCalledWith('$gone', 1);
  });

  it('anchors on the nearest surviving row above a reader row that left', () => {
    const previous = events('$root', '$a', '$reader');
    const next = events('$root', '$old', '$a', '$replacement');

    expect(plan(anchorOn(previous, '$reader'), next)).toEqual({
      foldPx: 10,
      probe: 'threadPrependFoldAnchorFallback',
    });
    expect(plan(anchorOn(previous, '$reader'), events('$root', '$other'))).toEqual({
      foldPx: 0,
      probe: 'threadPrependFoldAnchorLost',
    });
  });

  it('ignores an anchor from another thread', () => {
    const previous = events('$root', '$a', '$reader');
    const next = events('$root', '$old', '$a', '$reader');

    expect(plan({ ...anchorOn(previous, '$reader'), threadId: '$other' }, next)).toEqual({
      foldPx: 0,
    });
  });
});
