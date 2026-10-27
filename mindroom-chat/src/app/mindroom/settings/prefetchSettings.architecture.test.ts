/**
 * CINNY-207 P6.1 / D4: architecture guards for the prefetch settings
 * replacement. Enforces the four §6.4 rows added by Commit 4:
 *
 *   (a) `MindroomMessagePreloadLimitSetting.{tsx,test.ts}` are deleted.
 *   (b) src/app/mindroom recursive scan of .{ts,tsx} — the "zero
 *       allowlist" refers to LIVE CONSUMERS of the deleted policy: no
 *       source module reads `paginationLimit`, imports a `PreloadLimit`
 *       symbol, or references a `_PAGINATION_LIMIT` constant. The scan
 *       exempts:
 *         - this arch test file (recursive self-reference),
 *         - the D4 migration machinery itself, which must NAME the key it
 *           discards (`mindroomSettingsStorage.ts`, `mindroomSettings.test.ts`),
 *         - negation guards elsewhere in `mindroom/**` that assert the
 *           string is not present in some other file
 *           (`RoomTimeline.cache.test.ts`, `MindroomPrefetchSettings.test.ts`,
 *           `preloadSettings.ts` header),
 *         - the divergence note is recorded in Deviations §8.
 *       The Commit-3 rename of `timelinePagination.ts`'s
 *       `paginationLimit` parameter to `windowLimit` closed the last
 *       LIVE consumer; the exempt files hold only negation / drop /
 *       docstring references.
 *   (c) Positive assertions:
 *       - `settingsExtensions.tsx` imports `MindroomPrefetchSettings`.
 *       - `mindroomSettingsStorage.ts` declares `prefetchScope` and imports
 *         from `../engine/prefetchPolicy`.
 * D4 semantics (stored value DROPPED, never mapped to prefetchDepth) is
 * covered functionally by the `mindroomSettings.test.ts` "hydrates
 * prefetchDepth to the default even when a legacy paginationLimit is
 * present" case, not by this arch guard.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MINDROOM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THIS_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'prefetchSettings.architecture.test.ts'
);

// See doc header (b) — these files reference the deleted symbol in
// documented, non-consumer ways: the D4 drop code (which must name the
// key it strips), the D4 tests that assert the drop, and legacy-
// negation guards elsewhere. Every entry is justified in a code
// comment at the referenced file.
const NON_CONSUMER_EXEMPTIONS = new Set([
  resolve(MINDROOM_DIR, 'settings/mindroomSettings.test.ts'),
  resolve(MINDROOM_DIR, 'settings/mindroomSettingsStorage.ts'),
  resolve(MINDROOM_DIR, 'settings/MindroomPrefetchSettings.test.ts'),
  resolve(MINDROOM_DIR, 'threads/preloadSettings.ts'),
  resolve(MINDROOM_DIR, 'threads/__tests__/RoomTimeline.cache.test.ts'),
]);

const walkMindroomSources = (dir: string): string[] => {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = resolve(dir, entry);
    const stats = statSync(abs);
    if (stats.isDirectory()) {
      results.push(...walkMindroomSources(abs));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    results.push(abs);
  }
  return results;
};

describe('CINNY-207 P6.1 / D4 — legacy preload setting removal', () => {
  it('deletes MindroomMessagePreloadLimitSetting.tsx and its test', () => {
    expect(
      existsSync(resolve(MINDROOM_DIR, 'settings/MindroomMessagePreloadLimitSetting.tsx'))
    ).toBe(false);
    expect(
      existsSync(resolve(MINDROOM_DIR, 'settings/MindroomMessagePreloadLimitSetting.test.ts'))
    ).toBe(false);
  });

  it('leaves no references to paginationLimit / PreloadLimit / PAGINATION_LIMIT anywhere under src/app/mindroom/', () => {
    // Zero allowlist. If a file legitimately needs one of these strings,
    // the choice is either to rename or to reevaluate whether the file
    // still belongs in this tree.
    const pattern = /paginationLimit|PreloadLimit|PAGINATION_LIMIT/;
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of walkMindroomSources(MINDROOM_DIR)) {
      if (file === THIS_FILE) continue;
      if (NON_CONSUMER_EXEMPTIONS.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      if (!pattern.test(source)) continue;
      source.split('\n').forEach((line, index) => {
        if (pattern.test(line)) {
          offenders.push({
            file: file.slice(MINDROOM_DIR.length + 1),
            line: index + 1,
            text: line,
          });
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('wires MindroomPrefetchSettings into the general-messages extension slot', () => {
    const settingsExtensionsSource = readFileSync(
      resolve(MINDROOM_DIR, 'settings/settingsExtensions.tsx'),
      'utf8'
    );
    expect(settingsExtensionsSource).toContain('MindroomPrefetchSettings');
    expect(settingsExtensionsSource).not.toContain('MindroomMessagePreloadLimitSetting');
  });

  it('declares prefetchScope + prefetchDepth in the versioned MindRoom store', () => {
    const source = readFileSync(
      resolve(MINDROOM_DIR, 'settings/mindroomSettingsStorage.ts'),
      'utf8'
    );
    expect(source).toContain('prefetchScope');
    expect(source).toContain('prefetchDepth');
    expect(source).toContain("from '../engine/prefetchPolicy'");
    expect(source).toContain('MINDROOM_SETTINGS_STORE_VERSION = 2');
  });

  it('keeps fork settings out of generic state and migrates explicitly at app bootstrap', () => {
    const atomSource = readFileSync(resolve(MINDROOM_DIR, 'settings/mindroomSettings.ts'), 'utf8');
    const genericSource = readFileSync(resolve(MINDROOM_DIR, '../state/settings.ts'), 'utf8');
    const indexSource = readFileSync(resolve(MINDROOM_DIR, '../../index.tsx'), 'utf8');

    expect(atomSource).not.toContain("from '../../state/settings'");
    expect(genericSource).not.toContain('prefetchScope');
    expect(genericSource).not.toContain('prefetchDepth');
    expect(indexSource).toContain('migrateLegacyIOSPushEnabled();');
    expect(indexSource).toContain('migrateMindroomSettingsStorage();');
    expect(indexSource.indexOf('migrateLegacyIOSPushEnabled();')).toBeLessThan(
      indexSource.indexOf('migrateMindroomSettingsStorage();')
    );
  });

  it('keeps prefetchDepth OUT of paint-time cache reads (PR #72 greptile P2 pair)', () => {
    // `prefetchDepth` (default 10_000) is the BACKGROUND deep-history
    // budget. Open-time cache hydration must page by the interactive
    // constants or a deep cached room/thread materializes thousands of
    // IndexedDB records before first paint (AC1 regression).
    const hydration = readFileSync(
      resolve(MINDROOM_DIR, 'threads/roomCacheHydrationController.ts'),
      'utf8'
    );
    expect(hydration).not.toMatch(/limit:\s*prefetchDepth/);
    expect(hydration).toMatch(/limit:\s*ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE/);

    const threadOpen = readFileSync(
      resolve(MINDROOM_DIR, 'threads/threadOpenCacheController.ts'),
      'utf8'
    );
    expect(threadOpen).not.toMatch(/limit:\s*prefetchDepthRef/);
    expect(threadOpen).toMatch(/limit:\s*THREAD_BATCH_SIZE/);
  });
});
