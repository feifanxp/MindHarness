#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THREAD_TAGS_EVENT_TYPE = 'com.mindroom.thread.tags';
const TAG_NAME_RE = /^[a-z0-9-]{1,50}$/;
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const parseArgs = (argv) => {
  const args = {
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      args.write = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--homeserver') args.homeserver = value;
    else if (arg === '--room-id') args.roomId = value;
    else if (arg === '--access-token') args.accessToken = value;
    else throw new Error(`Unknown argument: ${arg}`);

    index += 1;
  }

  if (!args.homeserver || !args.roomId || !args.accessToken) {
    throw new Error(
      'Usage: node scripts/migrate-thread-tags.mjs --homeserver <url> --room-id <roomId> --access-token <token> [--write]'
    );
  }

  return args;
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeTagName = (value) => {
  const normalized = normalizeNonEmptyString(value)?.toLowerCase();
  if (!normalized || !TAG_NAME_RE.test(normalized)) {
    return null;
  }
  return normalized;
};

const requireTagName = (value) => {
  const normalized = normalizeTagName(value);
  if (!normalized) {
    throw new Error(`Invalid thread tag name: ${value}`);
  }
  return normalized;
};

const normalizeSetAt = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const normalized = date.toISOString();
    return ISO_8601_PATTERN.test(normalized) ? normalized : null;
  }

  if (
    typeof value !== 'string' ||
    !ISO_8601_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return null;
  }

  return value;
};

const normalizeNote = (value) => {
  if (value == null) return undefined;
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeData = (value) => {
  if (value == null) return undefined;
  if (!isRecord(value)) return null;

  return { ...value };
};

const cloneTags = (tags) => Object.fromEntries(Object.entries(tags).map(([tag, record]) => [tag, { ...record }]));

const cloneTagMap = (source) =>
  new Map(Array.from(source.entries(), ([threadRootId, tags]) => [threadRootId, cloneTags(tags)]));

const cloneTombstoneMap = (source) =>
  new Map(Array.from(source.entries(), ([threadRootId, tags]) => [threadRootId, new Set(tags)]));

const sortObject = (value) =>
  Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));

const recordToWireContent = (record) => ({
  set_by: record.set_by,
  set_at: record.set_at,
  ...(record.note !== undefined ? { note: record.note } : {}),
  ...(record.data !== undefined ? { data: record.data } : {}),
});

const parseTagRecord = (tagName, value, warnings, sourceLabel) => {
  const normalizedTagName = normalizeTagName(tagName);
  if (!normalizedTagName) {
    warnings.push(`Skipping invalid tag name ${JSON.stringify(tagName)} in ${sourceLabel}.`);
    return null;
  }

  if (!isRecord(value)) {
    warnings.push(`Skipping malformed ${normalizedTagName} payload in ${sourceLabel}.`);
    return null;
  }

  const setBy = normalizeNonEmptyString(value.set_by);
  const setAt = normalizeSetAt(value.set_at);
  const note = normalizeNote(value.note);
  const data = normalizeData(value.data);
  if (!setBy || !setAt || note === null || data === null) {
    warnings.push(`Skipping invalid ${normalizedTagName} payload in ${sourceLabel}.`);
    return null;
  }

  return {
    tagName: normalizedTagName,
    record: {
      set_by: setBy,
      set_at: setAt,
      ...(note !== undefined ? { note } : {}),
      ...(data !== undefined ? { data } : {}),
    },
  };
};

const parseLegacyThreadTagsContent = (threadRootId, content, warnings) => {
  if (!isRecord(content) || !isRecord(content.tags)) {
    return null;
  }

  const parsedTags = {};
  Object.entries(content.tags).forEach(([rawTagName, rawValue]) => {
    const parsedTag = parseTagRecord(
      rawTagName,
      rawValue,
      warnings,
      `legacy state ${JSON.stringify(threadRootId)}`
    );
    if (!parsedTag) return;

    parsedTags[parsedTag.tagName] = parsedTag.record;
  });

  if (Object.keys(parsedTags).length === 0) {
    return null;
  }

  return {
    threadRootId,
    tags: parsedTags,
  };
};

const parsePerTagStateKey = (stateKey) => {
  if (typeof stateKey !== 'string') return null;

  try {
    const parsed = JSON.parse(stateKey);
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return null;
    }

    const threadRootId = normalizeNonEmptyString(parsed[0]);
    const tagName = normalizeTagName(parsed[1]);
    if (!threadRootId || !threadRootId.startsWith('$') || !tagName) {
      return null;
    }

    return { threadRootId, tagName };
  } catch {
    return null;
  }
};

const buildPerTagStateKey = (threadRootId, tagName) =>
  JSON.stringify([threadRootId, requireTagName(tagName)]);

const mergeThreadTagRoomState = (
  legacyTagsByThread,
  perTagRecordsByThread,
  perTagTombstonesByThread
) => {
  const mergedThreadRootIds = new Set([
    ...legacyTagsByThread.keys(),
    ...perTagRecordsByThread.keys(),
    ...perTagTombstonesByThread.keys(),
  ]);

  const merged = new Map();
  Array.from(mergedThreadRootIds)
    .sort()
    .forEach((threadRootId) => {
      const mergedTags = cloneTags(legacyTagsByThread.get(threadRootId) ?? {});

      perTagTombstonesByThread.get(threadRootId)?.forEach((tagName) => {
        delete mergedTags[tagName];
      });

      Object.assign(mergedTags, perTagRecordsByThread.get(threadRootId));

      if (Object.keys(mergedTags).length > 0) {
        merged.set(threadRootId, { tags: sortObject(mergedTags) });
      }
    });

  return merged;
};

export const collectRoomState = (stateEvents) => {
  const warnings = [];
  const legacyStateKeys = [];
  const legacyStates = [];
  const legacyStatesByThread = new Map();
  const legacyTagsByThread = new Map();
  const perTagRecordsByThread = new Map();
  const perTagTombstonesByThread = new Map();

  stateEvents.forEach((event) => {
    if (!isRecord(event) || event.type !== THREAD_TAGS_EVENT_TYPE) {
      return;
    }

    const parsedStateKey = parsePerTagStateKey(event.state_key);
    if (parsedStateKey === null) {
      if (typeof event.state_key !== 'string') {
        return;
      }

      legacyStateKeys.push(event.state_key);
      const legacyState = parseLegacyThreadTagsContent(event.state_key, event.content, warnings);
      if (!legacyState) {
        return;
      }

      legacyStates.push(legacyState);
      legacyStatesByThread.set(legacyState.threadRootId, legacyState);
      legacyTagsByThread.set(legacyState.threadRootId, legacyState.tags);
      return;
    }

    if (!isRecord(event.content)) {
      return;
    }

    const { threadRootId, tagName } = parsedStateKey;
    if (Object.keys(event.content).length === 0) {
      const tombstones = perTagTombstonesByThread.get(threadRootId) ?? new Set();
      tombstones.add(tagName);
      perTagTombstonesByThread.set(threadRootId, tombstones);
      return;
    }

    const parsedTag = parseTagRecord(
      tagName,
      event.content,
      warnings,
      `per-tag state ${JSON.stringify(event.state_key)}`
    );
    if (!parsedTag) {
      return;
    }

    const records = perTagRecordsByThread.get(threadRootId) ?? {};
    records[parsedTag.tagName] = parsedTag.record;
    perTagRecordsByThread.set(threadRootId, records);
  });

  const merged = mergeThreadTagRoomState(
    legacyTagsByThread,
    perTagRecordsByThread,
    perTagTombstonesByThread
  );

  return {
    warnings,
    legacyStateKeys,
    legacyStates,
    legacyStatesByThread,
    legacyTagsByThread,
    perTagRecordsByThread,
    perTagTombstonesByThread,
    merged,
  };
};

const normalizeMergedStateForCompare = (merged) =>
  Object.fromEntries(
    Array.from(merged.entries(), ([threadRootId, content]) => [
      threadRootId,
      { tags: sortObject(content.tags) },
    ])
  );

export const buildMigrationPlans = (collectedState) => {
  const plans = collectedState.legacyStateKeys.map((threadRootId) => {
    const legacyState = collectedState.legacyStatesByThread.get(threadRootId);
    const existingPerTagRecords = collectedState.perTagRecordsByThread.get(threadRootId) ?? {};
    const existingPerTagTombstones =
      collectedState.perTagTombstonesByThread.get(threadRootId) ?? new Set();

    const writes = [];
    const skipped = [];

    Object.entries(legacyState?.tags ?? {}).forEach(([tagName, record]) => {
      if (existingPerTagRecords[tagName]) {
        skipped.push({
          threadRootId,
          tagName,
          reason: 'per-tag record already exists',
        });
        return;
      }

      if (existingPerTagTombstones.has(tagName)) {
        skipped.push({
          threadRootId,
          tagName,
          reason: 'per-tag tombstone already exists',
        });
        return;
      }

      writes.push({
        threadRootId,
        tagName,
        content: recordToWireContent(record),
      });
    });

    return {
      threadRootId,
      writes,
      tombstoneLegacy: true,
      skipped,
    };
  });

  const totalWrites = plans.reduce((sum, plan) => sum + plan.writes.length, 0);
  const totalLegacyTombstones = plans.filter((plan) => plan.tombstoneLegacy).length;
  const skipped = plans.flatMap((plan) => plan.skipped);

  return {
    plans,
    totalWrites,
    totalLegacyTombstones,
    skipped,
  };
};

export const predictMergedStateAfterMigration = (collectedState, migrationPlans) => {
  const predictedLegacyTags = cloneTagMap(collectedState.legacyTagsByThread);
  const predictedPerTagRecords = cloneTagMap(collectedState.perTagRecordsByThread);
  const predictedPerTagTombstones = cloneTombstoneMap(collectedState.perTagTombstonesByThread);

  migrationPlans.plans.forEach((plan) => {
    plan.writes.forEach((write) => {
      const threadRecords = predictedPerTagRecords.get(write.threadRootId) ?? {};
      threadRecords[write.tagName] = {
        set_by: write.content.set_by,
        set_at: write.content.set_at,
        ...(write.content.note !== undefined ? { note: write.content.note } : {}),
        ...(write.content.data !== undefined ? { data: write.content.data } : {}),
      };
      predictedPerTagRecords.set(write.threadRootId, threadRecords);
    });

    if (plan.tombstoneLegacy) {
      predictedLegacyTags.delete(plan.threadRootId);
    }
  });

  return mergeThreadTagRoomState(
    predictedLegacyTags,
    predictedPerTagRecords,
    predictedPerTagTombstones
  );
};

const buildRequestUrl = (homeserver, path) => new URL(path, homeserver).toString();

const requestJson = async (homeserver, accessToken, path, init = {}) => {
  const response = await fetch(buildRequestUrl(homeserver, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const fetchRoomState = (homeserver, accessToken, roomId) =>
  requestJson(
    homeserver,
    accessToken,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`
  );

const putRoomState = (homeserver, accessToken, roomId, stateKey, content) =>
  requestJson(
    homeserver,
    accessToken,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
      THREAD_TAGS_EVENT_TYPE
    )}/${encodeURIComponent(stateKey)}`,
    {
      method: 'PUT',
      body: JSON.stringify(content),
    }
  );

const printSummary = (modeLabel, collectedState, migrationPlans) => {
  const legacyTagCount = collectedState.legacyStates.reduce(
    (sum, state) => sum + Object.keys(state.tags).length,
    0
  );
  const perTagRecordCount = Array.from(collectedState.perTagRecordsByThread.values()).reduce(
    (sum, tags) => sum + Object.keys(tags).length,
    0
  );
  const perTagTombstoneCount = Array.from(collectedState.perTagTombstonesByThread.values()).reduce(
    (sum, tags) => sum + tags.size,
    0
  );

  console.log(`${modeLabel} summary:`);
  console.log(`- Legacy thread-tag events: ${collectedState.legacyStateKeys.length}`);
  console.log(`- Legacy tags parsed: ${legacyTagCount}`);
  console.log(`- Existing per-tag records: ${perTagRecordCount}`);
  console.log(`- Existing per-tag tombstones: ${perTagTombstoneCount}`);
  console.log(`- Planned per-tag writes: ${migrationPlans.totalWrites}`);
  console.log(`- Planned legacy tombstones: ${migrationPlans.totalLegacyTombstones}`);
  console.log(`- Skipped legacy tags: ${migrationPlans.skipped.length}`);
  console.log(`- Parser warnings: ${collectedState.warnings.length}`);
};

const printWarnings = (warnings) => {
  if (warnings.length === 0) return;

  console.warn('\nWarnings:');
  warnings.forEach((warning) => console.warn(`- ${warning}`));
};

const printSkipped = (skipped) => {
  if (skipped.length === 0) return;

  console.log('\nSkipped legacy tags:');
  skipped.forEach(({ threadRootId, tagName, reason }) => {
    console.log(`- ${threadRootId} / ${tagName}: ${reason}`);
  });
};

const printPlannedWrites = (plans) => {
  const writes = plans.flatMap((plan) => plan.writes);
  if (writes.length === 0) return;

  console.log('\nPer-tag writes:');
  writes.forEach((write) => {
    console.log(`- ${write.threadRootId} / ${write.tagName} -> ${buildPerTagStateKey(write.threadRootId, write.tagName)}`);
  });
};

const assertMergedStatesMatch = (expectedMerged, actualMerged, label) => {
  const expected = JSON.stringify(normalizeMergedStateForCompare(expectedMerged));
  const actual = JSON.stringify(normalizeMergedStateForCompare(actualMerged));
  if (expected !== actual) {
    throw new Error(`${label} verification failed: merged thread-tag state changed.`);
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const initialStateEvents = await fetchRoomState(args.homeserver, args.accessToken, args.roomId);
  if (!Array.isArray(initialStateEvents)) {
    throw new Error('Room state response was not an array.');
  }

  const collectedState = collectRoomState(initialStateEvents);
  const migrationPlans = buildMigrationPlans(collectedState);
  const predictedMergedState = predictMergedStateAfterMigration(collectedState, migrationPlans);

  printSummary(args.write ? 'Write' : 'Dry-run', collectedState, migrationPlans);
  printWarnings(collectedState.warnings);
  printSkipped(migrationPlans.skipped);
  printPlannedWrites(migrationPlans.plans);

  assertMergedStatesMatch(
    collectedState.merged,
    predictedMergedState,
    'Dry-run prediction'
  );

  if (!args.write) {
    console.log('\nDry-run complete. Re-run with --write to apply the migration.');
    return;
  }

  for (const plan of migrationPlans.plans) {
    for (const write of plan.writes) {
      await putRoomState(
        args.homeserver,
        args.accessToken,
        args.roomId,
        buildPerTagStateKey(write.threadRootId, write.tagName),
        write.content
      );
    }

    if (plan.tombstoneLegacy) {
      await putRoomState(
        args.homeserver,
        args.accessToken,
        args.roomId,
        plan.threadRootId,
        {}
      );
    }
  }

  const verifiedStateEvents = await fetchRoomState(args.homeserver, args.accessToken, args.roomId);
  if (!Array.isArray(verifiedStateEvents)) {
    throw new Error('Verification room state response was not an array.');
  }

  const verifiedState = collectRoomState(verifiedStateEvents);
  assertMergedStatesMatch(collectedState.merged, verifiedState.merged, 'Post-write');

  console.log('\nWrite complete. Post-write merged state matches the pre-migration view.');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
