#!/usr/bin/env node
/* eslint-disable no-console */
// Synthetic history. The separate Chrome probe verifies server counts and live rendering.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const HELP = `Usage: node scripts/seed-streaming-stress-room.mjs --manifest PATH [options]
  --homeserver URL   Loopback HTTP(S) origin; otherwise E2E_HOMESERVER or saved manifest
  --threads N        Roots (default 1000)
  --replies N        Replies per root (default 100)
  --edits N          Replacements per reply, ending completed (default 3)
  --concurrency N    Concurrent threads (default 16, maximum 64)
  --help            Show this help
Requires an existing disposable account: E2E_USERNAME and E2E_PASSWORD.
Defaults send 401000 events: roots + pending replies + streaming/completed edits.
Rerun with the same manifest and credentials to resume; keep its Matrix device.
Completed threads are skipped; interrupted threads reuse device/transaction IDs.
Use a durable artifact directory. Never run two seeders against one manifest.
See docs/testing.md for account setup and the Chrome probe's live verification.
`;

function loopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid loopback homeserver URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !(['localhost', '[::1]'].includes(url.hostname) || /^127\.\d+\.\d+\.\d+$/.test(url.hostname)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Homeserver must be a loopback HTTP(S) origin without credentials or a path.');
  }
  return url.origin;
}

function positiveInteger(value, name, maximum = 1_000_000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`--${name} must be an integer between 1 and ${maximum}.`);
  }
  return number;
}

function matrixClient(homeserver, signal) {
  const client = {
    accessToken: undefined,
    async request(path, method = 'GET', body) {
      const retry = method === 'GET' || method === 'PUT';
      for (let attempt = 0; ; attempt += 1) {
        signal.throwIfAborted();
        let response;
        let data;
        try {
          response = await fetch(`${homeserver}/_matrix/client/v3${path}`, {
            method,
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              ...(client.accessToken ? { Authorization: `Bearer ${client.accessToken}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          });
          data = await response.json();
        } catch {
          signal.throwIfAborted();
          response = undefined;
        }
        if (response?.ok) return data;
        if (
          !retry ||
          attempt === 4 ||
          (response && ![429, 502, 503, 504].includes(response.status))
        ) {
          // Server errors can echo credentials or request bodies; report only the status.
          throw Object.assign(
            new Error(`Matrix request failed (${response?.status ?? 'transport'}).`),
            { status: response?.status }
          );
        }
        const delay = Number(
          data?.retry_after_ms ?? Number(response?.headers.get('retry-after')) * 1000
        );
        await sleep(
          Number.isFinite(delay) && delay > 0 ? Math.min(delay, 30_000) : 100 * 2 ** attempt,
          undefined,
          { signal }
        );
      }
    },
  };
  return client;
}

function replyContent(thread, reply, revision, edits) {
  const marker = `STRESS-T${String(thread + 1).padStart(4, '0')}-R${String(reply + 1).padStart(
    3,
    '0'
  )}-V${revision}`;
  const status = revision === 0 ? 'pending' : revision === edits ? 'completed' : 'streaming';
  const paragraphs = Array.from(
    { length: revision + 1 },
    (_, index) =>
      `Step ${index + 1}: deterministic streamed response with useful details and inline code.`
  );
  return {
    msgtype: status === 'completed' ? 'm.text' : 'm.notice',
    body: `${marker}\n\n${paragraphs.join('\n\n')}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p><strong>${marker}</strong></p>${paragraphs
      .map((text) => `<p>${text} <code>thread_${thread + 1}</code></p>`)
      .join('')}`,
    'io.mindroom.stream_status': status,
  };
}

async function seedThread(client, manifest, index) {
  const send = async (suffix, content) => {
    const txnId = `${manifest.runId}-t${index}-${suffix}`;
    const result = await client.request(
      `/rooms/${encodeURIComponent(manifest.roomId)}/send/m.room.message/${txnId}`,
      'PUT',
      content
    );
    if (typeof result.event_id !== 'string' || !result.event_id.startsWith('$')) {
      throw new Error('Matrix send did not return an event ID.');
    }
    return result.event_id;
  };
  const rootId = await send('root', {
    msgtype: 'm.text',
    body: `Streaming stress thread ${index + 1}: deterministic agent responses`,
  });
  let latestReplyId = rootId;
  for (let reply = 0; reply < manifest.config.replies; reply += 1) {
    const replyId = await send(`r${reply}`, {
      ...replyContent(index, reply, 0, manifest.config.edits),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: latestReplyId },
      },
    });
    for (let revision = 1; revision <= manifest.config.edits; revision += 1) {
      const content = replyContent(index, reply, revision, manifest.config.edits);
      await send(`r${reply}-e${revision}`, {
        ...content,
        body: `* ${content.body}`,
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
      });
    }
    latestReplyId = replyId;
  }
  manifest.threads[index] = { index, rootId, latestReplyId, complete: true };
}

async function seed(options, manifestPath, controller) {
  const { signal } = controller;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read the manifest as a JSON object.');
  }
  const homeserver = loopbackOrigin(
    options.homeserver ?? manifest?.homeserver ?? process.env.E2E_HOMESERVER
  );
  const username = process.env.E2E_USERNAME;
  const config = Object.fromEntries(
    Object.entries({ threads: 1000, replies: 100, edits: 3 }).map(([key, fallback]) => [
      key,
      positiveInteger(options[key] ?? manifest?.config?.[key] ?? fallback, key),
    ])
  );
  const concurrency = positiveInteger(options.concurrency ?? 16, 'concurrency', 64);
  if (manifest) {
    if (
      manifest.version !== 1 ||
      manifest.homeserver !== homeserver ||
      manifest.username !== username ||
      !/^[a-f0-9-]{36}$/.test(manifest.runId ?? '') ||
      manifest.deviceId !== `STRESS_${manifest.runId}` ||
      manifest.roomAliasLocal !== `mindroom-streaming-stress-${manifest.runId}` ||
      JSON.stringify(manifest.config) !== JSON.stringify(config) ||
      !Array.isArray(manifest.threads) ||
      manifest.threads.length !== config.threads ||
      manifest.threads.some(
        (thread, index) =>
          thread?.index !== index ||
          typeof thread.complete !== 'boolean' ||
          (thread.complete &&
            (!thread.rootId?.startsWith('$') || !thread.latestReplyId?.startsWith('$')))
      )
    ) {
      throw new Error(
        'Manifest identity or workload differs; use original settings or a new manifest.'
      );
    }
  } else {
    const runId = randomUUID();
    manifest = {
      version: 1,
      runId,
      homeserver,
      username,
      deviceId: `STRESS_${runId}`,
      roomAliasLocal: `mindroom-streaming-stress-${runId}`,
      config,
      threads: Array.from({ length: config.threads }, (_, index) => ({ index, complete: false })),
    };
  }
  delete manifest.verified;
  let writes = Promise.resolve();
  const save = () => {
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    writes = writes.then(async () => {
      await writeFile(`${manifestPath}.writing`, serialized, { mode: 0o600 });
      await rename(`${manifestPath}.writing`, manifestPath);
    });
    return writes;
  };
  await save();
  const client = matrixClient(homeserver, signal);
  const session = await client.request('/login', 'POST', {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password: process.env.E2E_PASSWORD,
    device_id: manifest.deviceId,
  });
  if (
    typeof session.access_token !== 'string' ||
    !session.access_token ||
    !/^@[^:]+:.+$/.test(session.user_id ?? '') ||
    session.device_id !== manifest.deviceId ||
    (manifest.userId && manifest.userId !== session.user_id)
  ) {
    throw new Error('Matrix session does not match the manifest user/device.');
  }
  client.accessToken = session.access_token;
  manifest.userId = session.user_id;
  if (!manifest.roomId) {
    const alias = `#${manifest.roomAliasLocal}:${manifest.userId.slice(
      manifest.userId.indexOf(':') + 1
    )}`;
    // The stable alias recovers a lost create-room response on the next run.
    let room = await client
      .request(`/directory/room/${encodeURIComponent(alias)}`)
      .catch((error) => {
        if (error.status !== 404) throw error;
        return undefined;
      });
    room ??= await client.request('/createRoom', 'POST', {
      preset: 'private_chat',
      visibility: 'private',
      room_alias_name: manifest.roomAliasLocal,
      name: `Streaming stress: ${config.threads} threads × ${config.replies} replies`,
    });
    manifest.roomId = room.room_id;
  }
  if (typeof manifest.roomId !== 'string' || !manifest.roomId.startsWith('!')) {
    throw new Error('Manifest does not contain a room ID.');
  }
  await save();
  let next = 0;
  let failure;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, config.threads) }, async () => {
      try {
        while (!failure && next < config.threads) {
          signal.throwIfAborted();
          const index = next++;
          if (manifest.threads[index].complete) continue;
          await seedThread(client, manifest, index);
          await save();
          const completed = manifest.threads.filter((thread) => thread.complete).length;
          if (completed % 25 === 0 || completed === config.threads) {
            console.error(`Completed ${completed}/${config.threads} threads.`);
          }
        }
      } catch (error) {
        failure ??= error;
        controller.abort(error);
      }
    })
  );
  if (failure) throw failure;
  console.log(
    JSON.stringify({
      manifest: manifestPath,
      roomId: manifest.roomId,
      completedThreads: config.threads,
      expectedMessageEvents: config.threads * (1 + config.replies * (1 + config.edits)),
    })
  );
}

async function main() {
  const { values: options } = parseArgs({
    options: {
      manifest: { type: 'string' },
      homeserver: { type: 'string' },
      threads: { type: 'string' },
      replies: { type: 'string' },
      edits: { type: 'string' },
      concurrency: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (!options.manifest) throw new Error('--manifest PATH is required.');
  if (!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD) {
    throw new Error('Set E2E_USERNAME and E2E_PASSWORD for an existing disposable account.');
  }
  const manifestPath = resolve(options.manifest);
  await mkdir(dirname(manifestPath), { recursive: true });
  const lockPath = `${manifestPath}.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST')
      throw new Error('Manifest is locked; check its process before removing .lock.');
    throw error;
  });
  const controller = new AbortController();
  const interrupt = () =>
    controller.abort(new Error('Seeding interrupted; rerun the same manifest.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await lock.writeFile(`${process.pid}\n`);
    await seed(options, manifestPath, controller);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await lock.close();
    await unlink(lockPath);
  }
}
main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
