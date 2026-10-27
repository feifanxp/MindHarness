import { describe, expect, it } from 'vitest';
import {
  buildMigrationPlans,
  collectRoomState,
  predictMergedStateAfterMigration,
} from '../../../../scripts/migrate-thread-tags.mjs';
import { MINDROOM_THREAD_TAGS_EVENT } from './threadTags';

describe('migrate-thread-tags script helpers', () => {
  it('tombstones malformed legacy state keys even when no valid tags survive parsing', () => {
    const collectedState = collectRoomState([
      {
        type: MINDROOM_THREAD_TAGS_EVENT,
        state_key: '$root',
        content: {
          tags: {
            urgent: { set_by: '@alice:example.org' },
            'bad tag': {
              set_by: '@alice:example.org',
              set_at: '2026-04-07T00:00:01.000Z',
            },
          },
        },
      },
    ]);

    expect(collectedState.legacyStateKeys).toEqual(['$root']);
    expect(collectedState.legacyStates).toEqual([]);
    expect(collectedState.warnings).toEqual([
      'Skipping invalid urgent payload in legacy state "$root".',
      'Skipping invalid tag name "bad tag" in legacy state "$root".',
    ]);

    const migrationPlans = buildMigrationPlans(collectedState);

    expect(migrationPlans.plans).toEqual([
      {
        threadRootId: '$root',
        writes: [],
        tombstoneLegacy: true,
        skipped: [],
      },
    ]);
    expect(migrationPlans.totalWrites).toBe(0);
    expect(migrationPlans.totalLegacyTombstones).toBe(1);

    const predictedMergedState = predictMergedStateAfterMigration(collectedState, migrationPlans);

    expect(Array.from(predictedMergedState.entries())).toEqual(
      Array.from(collectedState.merged.entries())
    );
  });
});
