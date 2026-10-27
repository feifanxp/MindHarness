import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APPSTORE_FIXTURE_ROOM_ALIAS,
  APPSTORE_FIXTURE_ROOM_NAME,
  APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH,
  APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME,
  bodyToFormattedHtml,
  buildAppStoreFixtureThreads,
  buildCanonicalThreadTagStateKey,
  buildScheduledTaskContent,
  getAppStoreFixtureAgentDefinitions,
} from './appstore-fixture.mjs';

const SETUP_SCRIPT_URL = new URL('./appstore-fixture-up.sh', import.meta.url);
const SETUP_SCRIPT_PATH = fileURLToPath(SETUP_SCRIPT_URL);
const SCREENSHOT_SCRIPT_URL = new URL('./appstore-screenshots.sh', import.meta.url);
const SEED_SCRIPT_URL = new URL('./seed-appstore-screenshot-room.mjs', import.meta.url);
const APP_STORE_SCREENSHOTS_SPEC_URL = new URL(
  '../e2e/app-store-screenshots.spec.ts',
  import.meta.url
);

test('declares the public-safe App Store screenshot fixture room', () => {
  assert.equal(
    APPSTORE_FIXTURE_ROOM_ALIAS,
    '#mindroom-app-store-personal-showcase:matrix.localhost'
  );
  assert.equal(APPSTORE_FIXTURE_ROOM_NAME, 'Family');
  assert.equal(APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME, 'Sam Rivera');
  assert.equal(
    APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH,
    'scripts/fixtures/appstore/avatars/sam.png'
  );
});

test('defines fake AI agents with localpart prefixes and avatar assets', () => {
  const agents = getAppStoreFixtureAgentDefinitions();

  assert.deepEqual(
    agents.map((agent) => [agent.username, agent.displayName, agent.avatarAssetPath]),
    [
      ['mindroom_hearth', 'Hearth', 'scripts/fixtures/appstore/avatars/hearth.png'],
      ['mindroom_pantry', 'Pantry', 'scripts/fixtures/appstore/avatars/pantry.png'],
      ['mindroom_atlas', 'Atlas', 'scripts/fixtures/appstore/avatars/atlas.png'],
    ]
  );
});

test('formats fixture markdown as Matrix HTML for richer screenshots', () => {
  assert.equal(
    bodyToFormattedHtml(
      [
        'MindRoom is chat-native.',
        '',
        '**Everyday examples**',
        '- Watch for **campground cancellations**.',
        '- Run `schedule next scan` when needed.',
      ].join('\n')
    ),
    '<p>MindRoom is chat-native.</p><p><strong>Everyday examples</strong></p><ul><li>Watch for <strong>campground cancellations</strong>.</li><li>Run <code>schedule next scan</code> when needed.</li></ul>'
  );
});

test('builds fake fixture threads with AI run, tool trace, and summary metadata', () => {
  const threads = buildAppStoreFixtureThreads();

  const mindroomThread = threads.find((thread) => thread.id === 'mindroom-explained');
  const toolThread = threads.find((thread) => thread.id === 'campground-monitor');
  assert.ok(mindroomThread);
  assert.ok(toolThread);

  assert.match(mindroomThread.root.body, /plan dinners/);
  assert.equal(mindroomThread.replies[0].sender, 'pantry');
  assert.match(mindroomThread.replies[0].content.body, /Leo is vegetarian/);
  assert.match(mindroomThread.replies[0].content.body, /chickpea orzo/);
  assert.match(mindroomThread.replies[0].content.formatted_body, /<h2>Dinner, sorted<\/h2>/);
  assert.match(mindroomThread.replies[0].content.formatted_body, /<ul><li><strong>Mon:/);
  assert.equal(mindroomThread.replies[0].content['io.mindroom.ai_run'].status, 'completed');
  assert.equal(mindroomThread.summary.content['io.mindroom.thread_summary'].version, 1);

  assert.match(toolThread.root.body, /heading out/);
  assert.match(toolThread.replies[0].content.body, /🔧 `call_service` \[1\]/u);
  assert.equal(toolThread.replies[0].content['io.mindroom.tool_trace'].version, 2);
  assert.equal(
    toolThread.replies[0].content['io.mindroom.tool_trace'].events[0].tool_name,
    'call_service'
  );
});

test('uses topic-specific summary emoji and accurate thread depths', () => {
  const threads = buildAppStoreFixtureThreads();
  const messageCounts = threads.map(
    (thread) => thread.summary.content['io.mindroom.thread_summary'].message_count
  );
  const expectedSummaryEmojiByThread = new Map([
    ['personal-workspace', '🧭'],
    ['mindroom-explained', '🥗'],
    ['campground-monitor', '🏡'],
    ['car-search', '🇵🇹'],
    ['home-reminders', '⏰'],
  ]);
  const summaryEmoji = new Set();

  threads.forEach((thread) => {
    const expectedEmoji = expectedSummaryEmojiByThread.get(thread.id);
    assert.ok(expectedEmoji, `${thread.id} should have an expected summary emoji`);
    assert.match(
      thread.summary.content.body,
      new RegExp(`^${expectedEmoji} `, 'u'),
      `${thread.id} summary needs its topic-specific emoji`
    );
    assert.match(
      thread.summary.content['io.mindroom.thread_summary'].summary,
      new RegExp(`^${expectedEmoji} `, 'u'),
      `${thread.id} metadata summary needs its topic-specific emoji`
    );
    summaryEmoji.add(expectedEmoji);
  });
  assert.equal(summaryEmoji.size, threads.length, 'summary emoji should vary per thread');
  assert.deepEqual(
    messageCounts,
    threads.map((thread) => 1 + thread.replies.length)
  );
});

test('builds scheduled task and canonical tag state payloads for thread cards', () => {
  assert.deepEqual(buildScheduledTaskContent('$thread', '2026-07-05T18:00:00.000Z'), {
    status: 'pending',
    thread_id: '$thread',
    new_thread: false,
    execute_at: '2026-07-05T18:00:00.000Z',
  });

  assert.equal(buildCanonicalThreadTagStateKey('$thread', 'watcher'), '["$thread","watcher"]');
});

test('schedules tomorrow at four UTC, including DST and year boundaries', () => {
  for (const [now, expected] of [
    ['2026-10-01T23:30:00.000Z', '2026-10-02T16:00:00.000Z'],
    ['2026-11-01T08:30:00.000Z', '2026-11-02T16:00:00.000Z'],
    ['2026-12-31T23:59:00.000Z', '2027-01-01T16:00:00.000Z'],
  ]) {
    const threads = buildAppStoreFixtureThreads({ now: new Date(now) });
    const scheduledThreads = threads.filter((thread) => thread.scheduledAt);
    assert.equal(scheduledThreads.length, 1);
    const reminder = scheduledThreads[0];
    assert.equal(reminder.id, 'home-reminders');
    assert.equal(reminder.scheduledAt, expected);
    assert.ok(Date.parse(reminder.scheduledAt) > Date.parse(now));
    assert.match(reminder.root.body, /tomorrow at four/);
    assert.match(reminder.replies[0].content.body, /tomorrow at \*\*4:00 PM\*\*/);
  }
});

test('uses only Matrix-safe integer numbers in event payloads', () => {
  const threads = buildAppStoreFixtureThreads();

  const visit = (value, path = 'payload') => {
    if (typeof value === 'number') {
      assert.equal(Number.isSafeInteger(value), true, `${path} must be a safe integer`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    Object.entries(value).forEach(([key, child]) => visit(child, `${path}.${key}`));
  };

  visit(threads);
});

test('keeps the screenshot fixture free of copied private-room examples', () => {
  const serialized = JSON.stringify(buildAppStoreFixtureThreads()).toLowerCase();

  ['mullvad', 'daycare', 'fetish', 'erotic'].forEach((term) => {
    assert.equal(serialized.includes(term), false, `fixture should not include ${term}`);
  });
});

test('standalone setup script starts Matrix and seeds the fixture room', async () => {
  const script = await readFile(SETUP_SCRIPT_URL, 'utf8');

  assert.match(script, /scripts\/e2e-matrix-up\.sh/);
  assert.match(script, /scripts\/ensure-e2e-account\.sh/);
  assert.match(script, /scripts\/seed-appstore-screenshot-room\.mjs/);
  assert.match(script, /APPSTORE_SCREENSHOT_RUN_ID/);
  assert.match(script, /appstorescreenshots\$\{SAFE_RUN_ID\}/);
  assert.ok(
    script.includes(
      `E2E_FIXTURE_ROOM_ALIAS="#mindroom-app-store-personal-showcase-\${SAFE_RUN_ID}:matrix.localhost"`
    )
  );
});

test('standalone setup script does not inherit stale room aliases', async () => {
  const script = await readFile(SETUP_SCRIPT_URL, 'utf8');

  assert.doesNotMatch(script, /E2E_FIXTURE_ROOM_ALIAS:-/);
});

test('standalone setup script treats IPv6 loopback as a literal host pattern', async () => {
  const script = await readFile(SETUP_SCRIPT_URL, 'utf8');

  assert.ok(script.includes('http://\\[::1\\]:*'));
});

test('fixture markdown tokenizer avoids conditional assignment', async () => {
  const script = await readFile(new URL('./appstore-fixture.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /while\s*\(\([^)]*=\s*pattern\.exec\(value\)\)\s*!==\s*null\)/);
});

test('screenshot PNG reader validates the complete file signature', async () => {
  const script = await readFile(APP_STORE_SCREENSHOTS_SPEC_URL, 'utf8');

  assert.match(script, /PNG_MAGIC_SIGNATURE/);
  assert.match(script, /bytes\.subarray\(0,\s*PNG_MAGIC_SIGNATURE\.length\)/);
});

test('seeder keeps Matrix media upload fallback resilient', async () => {
  const script = await readFile(SEED_SCRIPT_URL, 'utf8');

  assert.match(script, /for \(const uploadBase of uploadBases\) {\n\s+try {/);
  assert.match(
    script,
    /catch \(error\) {\n\s+lastError = error instanceof Error \? error\.message : String\(error\);/
  );
});

test('seeder reuses parsed registration challenge bodies', async () => {
  const script = await readFile(SEED_SCRIPT_URL, 'utf8');

  assert.match(script, /error\.body = body;/);
  assert.match(script, /const challenge = error\.body \?\? {};/);
  assert.doesNotMatch(
    script,
    /const initialResponse = await fetch\(`\$\{HOMESERVER\}\/_matrix\/client\/v3\/register`/
  );
});

test('seeder stops when a required agent cannot log in or register', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appstore-agent-failure-'));
  try {
    const mockPath = join(root, 'mock-matrix.mjs');
    await writeFile(
      mockPath,
      `globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        const path = new URL(url).pathname;
        console.error('REQUEST', path);
        if (path.endsWith('/login') && body.identifier.user === 'fixture-primary') {
          return Response.json({ access_token: 'test-token', user_id: '@fixture-primary:matrix.localhost' });
        }
        if (path.endsWith('/login') || path.endsWith('/register')) {
          return Response.json({ errcode: 'M_FORBIDDEN', error: 'agent setup denied' }, { status: 403 });
        }
        throw new Error('Unexpected request after failed agent setup');
      };`
    );
    const result = spawnSync(
      process.execPath,
      ['--import', mockPath, fileURLToPath(SEED_SCRIPT_URL)],
      {
        env: {
          PATH: process.env.PATH,
          E2E_HOMESERVER: 'http://matrix.localhost',
          E2E_USERNAME: 'fixture-primary',
          E2E_PASSWORD: 'fixture-password',
          APPSTORE_FIXTURE_SET_PRIMARY_PROFILE: '0',
        },
        encoding: 'utf8',
        timeout: 10_000,
      }
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /seeding failed: Matrix API error: M_FORBIDDEN - agent setup denied/
    );
    assert.deepEqual(
      result.stderr.split('\n').filter((line) => line.startsWith('REQUEST')),
      [
        'REQUEST /_matrix/client/v3/login',
        'REQUEST /_matrix/client/v3/login',
        'REQUEST /_matrix/client/v3/register',
      ]
    );
    assert.doesNotMatch(result.stderr, /fixture ready|fallback|Unexpected request/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundles every demo avatar as a PNG without external profile downloads', async () => {
  const avatars = [
    APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH,
    ...getAppStoreFixtureAgentDefinitions().map((agent) => agent.avatarAssetPath),
  ];
  for (const path of avatars) {
    assert.ok(path.startsWith('scripts/fixtures/appstore/avatars/'));
    const bytes = await readFile(new URL(`../${path}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.readUInt32BE(16) > 0);
    assert.ok(bytes.readUInt32BE(20) > 0);
  }
  const script = await readFile(SEED_SCRIPT_URL, 'utf8');
  assert.match(script, /APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH/);
  assert.doesNotMatch(script, /setUserAvatarFromUrl/);
});

test('each demo sender has an agent profile and the configured demo model', () => {
  const profiles = new Map(getAppStoreFixtureAgentDefinitions().map((agent) => [agent.key, agent]));
  for (const thread of buildAppStoreFixtureThreads()) {
    assert.equal(thread.root.sender, 'primary');
    for (const reply of thread.replies) {
      assert.ok(profiles.has(reply.sender));
      const model = reply.content['io.mindroom.ai_run'].model;
      assert.deepEqual(
        model,
        reply.sender === 'atlas'
          ? { provider: 'anthropic', id: 'claude-opus-5-5', config: 'opus' }
          : { provider: 'openai', id: 'gpt-6-astra', config: 'astra' }
      );
    }
    assert.ok(profiles.has(thread.summary.sender));
  }
});

test('capture renders tomorrow-at-four reminders in the same UTC timezone', async () => {
  const spec = await readFile(APP_STORE_SCREENSHOTS_SPEC_URL, 'utf8');
  assert.match(spec, /timezoneId: 'UTC'/);
});

test('screenshot capture removes every stale file from the locale folder', async () => {
  const script = await readFile(SCREENSHOT_SCRIPT_URL, 'utf8');

  assert.match(script, /find "\$\{SCREENSHOT_DIR\}" -maxdepth 1 -type f ! -name '\.\*' -delete/);
  assert.doesNotMatch(script, /_iphone-6-9_/);
  assert.doesNotMatch(script, /_ipad-13_/);
});

test('standalone setup script rejects existing live-account mode', () => {
  const result = spawnSync('bash', [SETUP_SCRIPT_PATH], {
    env: {
      PATH: process.env.PATH,
      APPSTORE_SCREENSHOTS_USE_EXISTING_E2E: '1',
    },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing live-account screenshot capture is not supported/);
});

for (const setup of ['capture', 'account']) {
  test(`stops before the next stage when ${setup} setup fails`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'appstore-setup-failure-'));
    try {
      await mkdir(join(root, 'scripts'));
      await mkdir(join(root, 'bin'));
      const mainScript = setup === 'capture' ? SCREENSHOT_SCRIPT_URL : SETUP_SCRIPT_URL;
      const mainPath = join(root, 'scripts', 'main.sh');
      await writeFile(mainPath, await readFile(mainScript, 'utf8'));
      const failingScript =
        setup === 'capture' ? 'appstore-fixture-up.sh' : 'ensure-e2e-account.sh';
      const failurePath = join(root, 'scripts', failingScript);
      await writeFile(failurePath, '#!/bin/sh\necho setup-failed >&2\nexit 42\n');
      await chmod(failurePath, 0o755);
      if (setup === 'account') {
        const serverPath = join(root, 'scripts', 'e2e-matrix-up.sh');
        await writeFile(serverPath, '#!/bin/sh\nexit 0\n');
        await chmod(serverPath, 0o755);
      }
      for (const name of ['node', 'npx']) {
        const nextPath = join(root, 'bin', name);
        await writeFile(nextPath, '#!/bin/sh\necho NEXT-STAGE >&2\nexit 0\n');
        await chmod(nextPath, 0o755);
      }
      const result = spawnSync('bash', [mainPath], {
        env: {
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          E2E_PORT: '4173',
          APPSTORE_SCREENSHOT_RUN_ID: 'failure-test',
        },
        encoding: 'utf8',
      });
      assert.equal(result.status, 42);
      assert.match(result.stderr, /setup-failed/);
      assert.doesNotMatch(result.stderr, /NEXT-STAGE/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
