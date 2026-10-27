import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  COMPACT_COVERAGE_MAX_BATCHES,
  COMPACT_COVERAGE_TARGET_EVENTS,
  shouldRunCompactCoverageBackfill,
  useCompactCoverageBackfillController,
} from './compactCoverageBackfillController';

type HarnessProps = {
  enabled: boolean;
  loadedEventCount: number;
  hasZeroReplyRootCoverage: boolean;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  paginateBack: (backwards: boolean) => Promise<void>;
};

const CoverageHarness = (props: HarnessProps) => {
  useCompactCoverageBackfillController(props);
  return null;
};

const baseProps = (paginateBack: HarnessProps['paginateBack']): HarnessProps => ({
  enabled: true,
  loadedEventCount: 0,
  hasZeroReplyRootCoverage: false,
  canPaginateBack: true,
  hasMoreCachedBack: false,
  paginateBack,
});

const flush = async (ticks = COMPACT_COVERAGE_MAX_BATCHES * 2) => {
  await act(async () => {
    for (let tick = 0; tick < ticks; tick += 1) {
      await Promise.resolve();
    }
  });
};

describe('compact coverage backfill', () => {
  it('runs only while coverage, budget, and a back source require it', () => {
    const base = {
      ...baseProps(vi.fn()),
      batchesUsed: 0,
    };
    const { paginateBack: _paginateBack, ...decision } = base;

    expect(shouldRunCompactCoverageBackfill(decision)).toBe(true);
    expect(shouldRunCompactCoverageBackfill({ ...decision, enabled: false })).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({
        ...decision,
        loadedEventCount: COMPACT_COVERAGE_TARGET_EVENTS,
        hasZeroReplyRootCoverage: true,
      })
    ).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({
        ...decision,
        loadedEventCount: COMPACT_COVERAGE_TARGET_EVENTS,
      })
    ).toBe(true);
    expect(
      shouldRunCompactCoverageBackfill({
        ...decision,
        batchesUsed: COMPACT_COVERAGE_MAX_BATCHES,
      })
    ).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({
        ...decision,
        canPaginateBack: false,
      })
    ).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({
        ...decision,
        canPaginateBack: false,
        hasMoreCachedBack: true,
      })
    ).toBe(true);
  });

  it('keeps one request in flight and uses the latest callback for the next batch', async () => {
    let resolvePagination: (() => void) | undefined;
    const paginateBack = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePagination = resolve;
        })
    );
    const replacementPaginateBack = vi.fn(
      () =>
        new Promise<void>(() => {
          // Keep the second batch pending.
        })
    );
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(React.createElement(CoverageHarness, baseProps(paginateBack)));
    });
    await act(async () => {
      renderer?.update(
        React.createElement(CoverageHarness, {
          ...baseProps(replacementPaginateBack),
          loadedEventCount: 1,
        })
      );
    });

    expect(paginateBack).toHaveBeenCalledTimes(1);
    expect(paginateBack).toHaveBeenCalledWith(true);
    expect(replacementPaginateBack).not.toHaveBeenCalled();

    await act(async () => {
      resolvePagination?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(paginateBack).toHaveBeenCalledTimes(1);
    expect(replacementPaginateBack).toHaveBeenCalledTimes(1);
    renderer?.unmount();
  });

  it('continues after an unchanged or failed page, then stops at the budget', async () => {
    const paginateBack = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValue(undefined);

    await act(async () => {
      create(React.createElement(CoverageHarness, baseProps(paginateBack)));
    });
    await flush();

    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_COVERAGE_MAX_BATCHES);
  });
});
