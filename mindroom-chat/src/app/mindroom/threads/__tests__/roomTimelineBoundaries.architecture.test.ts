import { describe, expect, it } from 'vitest';
import { mindroomFile, pathExists, resolvedDependencies } from './architectureTestUtils';

const TIMELINE_FILE = mindroomFile('threads/MindroomRoomTimeline.tsx');

const FORBIDDEN_LOW_LEVEL_DEPENDENCIES = [
  'threads/cacheStore/index.ts',
  'threads/eventRepository.ts',
  'threads/roomDeepLink.ts',
  'threads/roomPreloadTarget.ts',
  'threads/threadCacheCoverage.ts',
  'threads/threadFilterDsl.ts',
  'threads/threadOpenSdkBootstrap.ts',
  'threads/threadOpenCacheController.ts',
  'threads/threadOpenCacheFirst.ts',
  'threads/threadOpenSeedController.ts',
  'threads/threadOpenTargetEvent.ts',
  'threads/threadPaginationUtils.ts',
  'threads/threadRoomFocus.ts',
  'threads/useThreadRenderState.ts',
  'threads/sdk/threadBootstrapSdk.ts',
] as const;

describe('MindroomRoomTimeline dependency boundary', () => {
  it('composes pagination ownership without coupling its data owner to DOM or parent', () => {
    const pagination = mindroomFile('threads/session/useThreadPagination.ts');
    const viewport = mindroomFile('threads/useThreadPrependViewport.ts');
    expect(pathExists(pagination)).toBe(true);
    expect(pathExists(viewport)).toBe(true);
    expect(resolvedDependencies(TIMELINE_FILE)).toContain(pagination);
    expect(resolvedDependencies(TIMELINE_FILE)).toContain(viewport);
    const dependencies = resolvedDependencies(pagination);
    for (const forbidden of [
      TIMELINE_FILE,
      viewport,
      mindroomFile('threads/threadBackPaginationController.ts'),
      mindroomFile('threads/timelineScrollUtils.ts'),
      mindroomFile('threads/scrollQuiescence.ts'),
    ]) {
      expect(dependencies).not.toContain(forbidden);
    }
  });
  it('does not bypass adapters to import low-level cache or policy modules', () => {
    const dependencies = resolvedDependencies(TIMELINE_FILE, { includeTypeOnly: false });

    for (const dependency of FORBIDDEN_LOW_LEVEL_DEPENDENCIES) {
      expect(pathExists(mindroomFile(dependency)), `missing guarded owner ${dependency}`).toBe(
        true
      );
      expect(dependencies, `timeline bypasses its adapter via ${dependency}`).not.toContain(
        mindroomFile(dependency)
      );
    }
  });
});
