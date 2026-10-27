import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./seed-streaming-stress-room.mjs', import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mindroom-stress-'));
  const manifest = join(directory, 'manifest.json');
  const state = { room: false, events: new Map(), requests: [], fault: () => undefined };
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const path = decodeURIComponent(request.url.replace('/_matrix/client/v3', ''));
    state.requests.push({ path, body });
    const reply = (status, data, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      response.end(JSON.stringify(data));
    };
    const fault = state.fault(path, body);
    if (fault) return reply(fault.status, fault.body ?? {}, fault.headers);
    if (path === '/login')
      return reply(200, {
        user_id: '@stress:test.local',
        access_token: 'secret-test-token',
        device_id: body.device_id,
      });
    if (path.startsWith('/directory/room/')) {
      return reply(state.room ? 200 : 404, { room_id: '!stress:test.local' });
    }
    if (path === '/createRoom') {
      state.room = true;
      return reply(200, { room_id: '!stress:test.local' });
    }
    if (path.includes('/send/m.room.message/')) {
      if (!state.events.has(path))
        state.events.set(path, {
          event_id: `$event-${state.events.size}`,
          content: body,
        });
      return reply(200, { event_id: state.events.get(path).event_id });
    }
    return reply(404, {});
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await rm(directory, { recursive: true, force: true });
  });
  const run = (args = [], env = {}, onSpawn = () => {}) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          script,
          '--manifest',
          manifest,
          '--homeserver',
          `http://127.0.0.1:${server.address().port}`,
          '--threads',
          '2',
          '--replies',
          '2',
          '--edits',
          '3',
          '--concurrency',
          '1',
          ...args,
        ],
        {
          env: {
            ...process.env,
            E2E_USERNAME: 'stress',
            E2E_PASSWORD: 'secret-test-password',
            ...env,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.on('close', (code) => resolve({ code, output }));
      onSpawn(child);
    });
  return { state, run, manifest };
}

test('requires an existing explicit account without registering or sending requests', async (t) => {
  const { state, run } = await fixture(t);
  for (const env of [{ E2E_PASSWORD: '' }, { E2E_USERNAME: '' }]) {
    const result = await run([], env);
    assert.equal(result.code, 1);
    assert.match(result.output, /E2E_USERNAME.*E2E_PASSWORD/);
  }
  assert.equal(state.requests.length, 0);
  state.fault = () => ({ status: 403 });
  assert.equal((await run()).code, 1);
  assert.deepEqual(
    state.requests.map(({ path }) => path),
    ['/login']
  );
});

test('seeds exact pending/streaming/completed thread payloads without leaking credentials', async (t) => {
  const { state, run, manifest } = await fixture(t);
  const result = await run();
  assert.equal(result.code, 0, result.output);
  const events = [...state.events.values()];
  assert.equal(events.length, 18);
  const roots = events.filter(({ content }) => !content['m.relates_to']);
  assert.equal(roots.length, 2);
  for (const root of roots) {
    const replies = events.filter(
      ({ content }) => content['m.relates_to']?.event_id === root.event_id
    );
    assert.equal(replies.length, 2);
    for (const reply of replies) {
      assert.equal(reply.content['m.relates_to'].rel_type, 'm.thread');
      assert.equal(reply.content['io.mindroom.stream_status'], 'pending');
      assert.equal(reply.content.msgtype, 'm.notice');
      const edits = events.filter(
        ({ content }) => content['m.relates_to']?.event_id === reply.event_id
      );
      assert.deepEqual(
        edits.map(({ content }) => content['io.mindroom.stream_status']),
        ['streaming', 'streaming', 'completed']
      );
      edits.forEach(({ content }, index) => {
        assert.equal(content['m.relates_to'].rel_type, 'm.replace');
        assert.equal(content.msgtype, index === 2 ? 'm.text' : 'm.notice');
        assert.equal(content.body, `* ${content['m.new_content'].body}`);
        assert.equal(content.formatted_body, content['m.new_content'].formatted_body);
        assert.equal(
          content['io.mindroom.stream_status'],
          content['m.new_content']['io.mindroom.stream_status']
        );
      });
    }
  }
  const saved = await readFile(manifest, 'utf8');
  assert.equal(JSON.parse(saved).threads.filter(({ complete }) => complete).length, 2);
  assert.doesNotMatch(saved + result.output, /secret-test-(password|token)/);
});

test('resumes interrupted threads with stable transactions while skipping completed checkpoints', async (t) => {
  const { state, run, manifest } = await fixture(t);
  state.fault = (_, body) =>
    body['m.new_content']?.body.startsWith('STRESS-T0002-R001-V1') ? { status: 403 } : undefined;
  assert.equal((await run()).code, 1);
  assert.deepEqual(
    JSON.parse(await readFile(manifest, 'utf8')).threads.map(({ complete }) => complete),
    [true, false]
  );
  const before = state.requests.length;
  let throttledAt;
  let retriedAt;
  state.fault = (path) => {
    if (path.includes('/send/')) {
      if (!throttledAt) {
        throttledAt = Date.now();
        return { status: 429, headers: { 'Retry-After': '1' } };
      }
      retriedAt ??= Date.now();
    }
    return undefined;
  };
  const resumed = await run();
  assert.equal(resumed.code, 0, resumed.output);
  assert.ok(retriedAt - throttledAt >= 900, 'Retry-After must delay the resumed request');
  assert.equal(state.events.size, 18);
  assert.ok(
    state.requests
      .slice(before)
      .filter(({ path }) => path.includes('/send/'))
      .every(({ path }) => path.includes('-t1-'))
  );
  const devices = state.requests
    .filter(({ path }) => path === '/login')
    .map(({ body }) => body.device_id);
  assert.equal(new Set(devices).size, 1);
});

test('rejects external origins and changed or malformed manifests before network access', async (t) => {
  const { state, run, manifest } = await fixture(t);
  for (const args of [
    ['--homeserver', 'https://matrix.org'],
    ['--threads', '0'],
  ]) {
    assert.equal((await run(args)).code, 1);
  }
  await writeFile(manifest, 'null\n');
  assert.equal((await run()).code, 1);
  assert.equal(await readFile(manifest, 'utf8'), 'null\n');
  assert.equal(state.requests.length, 0);
  await rm(manifest);
  assert.equal((await run()).code, 0);
  const before = state.requests.length;
  assert.equal((await run(['--replies', '3'])).code, 1);
  assert.equal(state.requests.length, before);
});

test(
  'SIGTERM aborts retry waits, releases the lock, and preserves resumability',
  { timeout: 10_000 },
  async (t) => {
    const { state, run, manifest } = await fixture(t);
    let child;
    state.fault = (path) => {
      if (!path.includes('/send/')) return undefined;
      setTimeout(() => child.kill('SIGTERM'), 25);
      return { status: 429, body: { retry_after_ms: 30_000 } };
    };
    assert.equal(
      (
        await run([], {}, (process) => {
          child = process;
        })
      ).code,
      1
    );
    await assert.rejects(readFile(`${manifest}.lock`), { code: 'ENOENT' });
    state.fault = () => undefined;
    const resumed = await run();
    assert.equal(resumed.code, 0, resumed.output);
    assert.equal(state.events.size, 18);
  }
);
