#!/usr/bin/env node
/* eslint-disable no-console */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(repo, 'node_modules/@playwright/test/cli.js');
const serialSpec =
  /(?:^|\/)(?:perf-|ios-momentum-invariants|thread-ride-under-latency|thread-fast-scroll-overlap|message-rendering-performance|thinking-marker|long-message-expansion-default|app-store-screenshots|minimap-verify|worker-computer|deployed-auth-shell)/;

export function reportPassed({ stats, errors }, code, cases) {
  const total = ['expected', 'unexpected', 'flaky', 'skipped'].reduce(
    (n, key) => n + (stats[key] ?? 0),
    0
  );
  return (
    code === 0 &&
    total === cases &&
    stats.expected > 0 &&
    !errors?.length &&
    !stats.unexpected &&
    !stats.flaky
  );
}

export function plan(reports, root = repo) {
  const jobs = new Map();
  for (const { config, report } of reports) {
    if (report.errors?.length) throw new Error(`Discovery failed: ${config}`);
    const visit = (suite, titles = []) => {
      for (const spec of suite.specs ?? []) {
        const file = relative(root, resolve(report.config.rootDir, spec.file));
        // This standalone benchmark reuses a verified manifest and its account.
        // The scheduler's fresh credentials cannot access that fixture room.
        if (file === 'e2e/live/perf-large-room-streaming.spec.ts') continue;
        for (const { projectName: project } of spec.tests) {
          const key = `${file}:${project}`;
          if (!jobs.has(key)) jobs.set(key, { file, project, config, titles: new Set() });
          const job = jobs.get(key);
          const title = [...titles, spec.title].join(' / ');
          if (job.config !== config && !job.titles.has(title))
            throw new Error(`Conflicting configuration subsets: ${key}`);
          job.titles.add(title);
        }
      }
      for (const child of suite.suites ?? []) visit(child, [...titles, child.title]);
    };
    visit(report);
  }
  return [...jobs.values()].map(({ titles, ...job }) => ({
    ...job,
    cases: titles.size,
    serial: serialSpec.test(job.file),
  }));
}

export async function runJobs(jobs, concurrency, execute) {
  const results = [];
  for (const serial of [false, true]) {
    const queue = jobs.filter((job) => !!job.serial === serial);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(serial ? 1 : concurrency, queue.length) }, async () => {
        while (next < queue.length) {
          const job = queue[next++];
          try {
            results.push({ ...job, ...(await execute(job)) });
          } catch (error) {
            results.push({ ...job, status: 'failed', error: error.message });
          }
        }
      })
    );
  }
  return results;
}

const loopback = (value) => {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Use HTTP loopback origins for local fixture services.');
  return url.origin;
};

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      jobs: { type: 'string', default: '8' },
      list: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(
      'Usage: npm run test:e2e:parallel -- [--jobs 8] [--list] [e2e/file.spec.ts ...]\nSetup: docs/testing.md'
    );
    return;
  }
  const concurrency = Number(values.jobs);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64)
    throw new Error('--jobs must be an integer from 1 to 64.');
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('E2E_'))
  );
  Object.assign(baseEnv, { CI: '1', E2E_NO_WEB_SERVER: '1' });
  const configs = readdirSync(repo).filter((file) =>
    /^playwright(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/.test(file)
  );
  configs.sort((a, b) =>
    a === 'playwright.config.ts' ? -1 : b === 'playwright.config.ts' ? 1 : a.localeCompare(b)
  );
  const jobs = plan(
    configs.map((config) => {
      const listed = spawnSync(
        process.execPath,
        [cli, 'test', '-c', config, '--list', '--reporter=json'],
        { cwd: repo, env: baseEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      );
      if (listed.status !== 0) throw new Error(`Discovery failed: ${config}\n${listed.stderr}`);
      return { config, report: JSON.parse(listed.stdout) };
    })
  );
  const files = positionals.map((file) => file.replace(/^\.\//, ''));
  for (const file of files)
    if (!jobs.some((job) => job.file === file)) throw new Error(`Unknown spec: ${file}`);
  const selected = jobs.filter((job) => !files.length || files.includes(job.file));
  if (!selected.length) throw new Error('No tests discovered.');
  console.log(
    `${selected.length} spec/project jobs, ${selected.reduce((n, job) => n + job.cases, 0)} cases`
  );
  if (values.list) {
    for (const job of selected)
      console.log(
        `${job.serial ? 'serial' : 'parallel'} ${job.project} ${job.file} (${job.cases})`
      );
    return;
  }
  if (process.platform === 'win32') throw new Error('Use Linux, macOS, or WSL.');
  if (!AbortSignal.any) throw new Error('Use Node from .node-version (see docs/testing.md).');
  const homeserver = loopback(process.env.E2E_HOMESERVER);
  const production = loopback(process.env.E2E_BASE_URL);
  const development = loopback(process.env.E2E_DEV_BASE_URL);
  const directory = resolve(process.env.E2E_ARTIFACTS ?? 'test-results/parallel', randomUUID());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  console.log(`Artifacts: ${directory}`);
  const abort = new AbortController();
  const children = new Set();
  let shutdown;
  const kill = (pid, signal) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const interrupt = () => {
    abort.abort();
    const pids = [...children];
    pids.forEach((pid) => kill(pid, 'SIGTERM'));
    shutdown = new Promise((done) => {
      setTimeout(() => {
        pids.forEach((pid) => kill(pid, 'SIGKILL'));
        done();
      }, 2000);
    });
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const run = (command, args, env, cwd, log) =>
    new Promise((done, reject) => {
      abort.signal.throwIfAborted();
      const fd = openSync(log, 'a', 0o600);
      const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
      closeSync(fd);
      if (child.pid) children.add(child.pid);
      child.once('error', reject);
      child.once('close', (code) => {
        children.delete(child.pid);
        done(code);
      });
    });
  const api = async (path, token, body) => {
    const response = await fetch(`${homeserver}/_matrix/client/v3${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`Matrix fixture request failed (${response.status})`);
    return response.json();
  };
  const results = await runJobs(selected, concurrency, async (job) => {
    if (abort.signal.aborted) return { status: 'interrupted' };
    const id = randomUUID().replaceAll('-', '');
    const output = resolve(directory, `${job.file.replaceAll('/', '_')}-${job.project}`);
    mkdirSync(output, { recursive: true });
    console.log(`START ${job.project} ${job.file}`);
    const env = { ...baseEnv, E2E_BASE_URL: production, E2E_HOMESERVER: homeserver };
    const setup = async (command, args) => {
      if ((await run(command, args, env, repo, resolve(output, 'setup.log'))) !== 0)
        throw new Error(`Fixture setup failed; see ${output}/setup.log`);
    };
    if (job.file === 'e2e/worker-computer.spec.ts') {
      if (!process.env.E2E_COMPUTER_FIXTURE)
        return { status: 'blocked', reason: 'Set E2E_COMPUTER_FIXTURE.' };
      env.E2E_COMPUTER_FIXTURE = resolve(process.env.E2E_COMPUTER_FIXTURE);
      const fixture = JSON.parse(readFileSync(env.E2E_COMPUTER_FIXTURE, 'utf8'));
      for (const key of ['ui_origin', 'api_origin', 'homeserver']) loopback(fixture[key]);
      if (new URL(fixture.ui_origin).origin !== production)
        throw new Error('Worker fixture UI origin must match E2E_BASE_URL.');
    } else if (job.file === 'e2e/deployed-auth-shell.spec.ts') {
      if (!process.env.E2E_SSO_HOMESERVER)
        return { status: 'blocked', reason: 'Set E2E_SSO_HOMESERVER.' };
      env.E2E_HOMESERVER = process.env.E2E_SSO_HOMESERVER;
    } else {
      for (const suffix of ['', '_SECOND', '_THIRD', '_DEACTIVATE', '_AGENT']) {
        const prefix = `E2E${suffix}`;
        env[`${prefix}_USERNAME`] = `${
          suffix === '_AGENT' ? 'mindroom_' : ''
        }lv${id}${suffix.toLowerCase()}`;
        env[`${prefix}_PASSWORD`] = randomUUID();
        await setup('bash', [
          resolve(repo, 'scripts/ensure-e2e-account.sh'),
          prefix,
          env[`${prefix}_USERNAME`],
          env[`${prefix}_PASSWORD`],
        ]);
      }
      const login = (username, password) =>
        api('/login', null, {
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: username },
          password,
        });
      const primary = await login(env.E2E_USERNAME, env.E2E_PASSWORD);
      const server = primary.user_id.slice(primary.user_id.indexOf(':') + 1);
      Object.assign(env, {
        E2E_AGENT_USER_ID: `@${env.E2E_AGENT_USERNAME}:${server}`,
        E2E_FIXTURE_ROOM_ALIAS: `#lv${id}:${server}`,
        E2E_UI_ACTIONS_HOMESERVER: homeserver,
        E2E_DEPLOYED_BASE_URL: production,
        E2E_DEPLOYED_HOMESERVER: homeserver,
        E2E_DEPLOYED_USERNAME: env.E2E_USERNAME,
        E2E_DEPLOYED_PASSWORD: env.E2E_PASSWORD,
        SHOT_PREFIX: id,
        APPSTORE_FIXTURE_SET_PRIMARY_PROFILE: '1',
      });
      await setup(process.execPath, [
        resolve(
          repo,
          job.file.includes('app-store-screenshots')
            ? 'scripts/seed-appstore-screenshot-room.mjs'
            : 'e2e/live/seed-fixture-room.mjs'
        ),
      ]);
      const { room_id: room } = await api(
        `/directory/room/${encodeURIComponent(env.E2E_FIXTURE_ROOM_ALIAS)}`
      );
      if (!room) throw new Error('Fixture room lookup returned no room ID.');
      env.E2E_FIXTURE_ROOM_ID = room;
      env.E2E_ROOM_ID = room;
      if (job.file.includes('narrow-toolbar')) {
        await api(`/rooms/${encodeURIComponent(room)}/invite`, primary.access_token, {
          user_id: env.E2E_AGENT_USER_ID,
        });
        const agent = await login(env.E2E_AGENT_USERNAME, env.E2E_AGENT_PASSWORD);
        await api(`/join/${encodeURIComponent(room)}`, agent.access_token, {});
      }
      if (job.file.includes('minimap-verify'))
        await setup('bash', [resolve(repo, 'e2e/live/fixtures/minimap-fixture.sh')]);
    }
    const source = readFileSync(resolve(repo, job.file), 'utf8');
    if (
      source.includes('/e2e/fixtures/') ||
      /diagnostics-storage-fallback|cinny124-flight-recorder|device-pairing/.test(job.file)
    )
      env.E2E_BASE_URL = development;
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = resolve(output, 'report.json');
    const pattern = resolve(repo, job.file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
    const code = await run(
      process.execPath,
      [
        cli,
        'test',
        pattern,
        '-c',
        resolve(repo, job.config),
        '--project',
        job.project,
        '--workers=1',
        '--retries=0',
        '--reporter=list,json',
        '--output',
        resolve(output, 'results'),
      ],
      env,
      output,
      resolve(output, 'playwright.log')
    );
    const report = JSON.parse(readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'utf8'));
    const stats = report.stats;
    const status = reportPassed(report, code, job.cases) ? 'passed' : 'failed';
    console.log(`${status.toUpperCase()} ${job.project} ${job.file}`);
    return { status, stats, output };
  });
  await shutdown;
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(results, null, 2) + '\n', {
    mode: 0o600,
  });
  for (const result of results.filter(({ status }) => status !== 'passed'))
    console.error(
      `${result.status}: ${result.file}: ${result.reason ?? result.error ?? result.output}`
    );
  process.exitCode = abort.signal.aborted
    ? 130
    : results.every(({ status }) => status === 'passed')
    ? 0
    : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
