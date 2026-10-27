#!/usr/bin/env node
/**
 * Idempotent fixture seeding for Cinny live e2e tests (Tier 3).
 *
 * Usage:
 *   node e2e/live/seed-fixture-room.mjs
 *
 * Environment:
 *   E2E_USERNAME / E2E_PASSWORD  — Matrix credentials
 *   E2E_HOMESERVER               — defaults to https://mindroom.lab.mindroom.chat
 *   E2E_FIXTURE_ROOM_ALIAS       — defaults to #cinny-e2e-fixture:mindroom.lab.mindroom.chat
 *
 * What it does:
 *   1. Logs in via Matrix CS API
 *   2. Creates or joins room with the configured fixture alias
 *   3. Sends a thread root + 3 thread replies (if not already present)
 *   4. Sends a thread root + 3 hidden threaded metadata relations (if not already present)
 *   5. Sends an m.notice with io.mindroom.thread_summary content (if not already present)
 *
 * Idempotency: checks room state before sending. Safe to run multiple times.
 */

const HOMESERVER = process.env.E2E_HOMESERVER || 'https://mindroom.lab.mindroom.chat';
const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const ROOM_ALIAS =
  process.env.E2E_FIXTURE_ROOM_ALIAS || '#cinny-e2e-fixture:mindroom.lab.mindroom.chat';
const ROOM_ALIAS_LOCAL = (() => {
  const match = /^#([^:]+):.+$/.exec(ROOM_ALIAS);
  return match ? match[1] : 'cinny-e2e-fixture';
})();
const THREAD_ROOT_MARKER = '[cinny-e2e] Thread fixture root';
const HIDDEN_THREAD_RELATION_ROOT_MARKER = '[cinny-e2e] Hidden relation thread root';
const SUMMARY_MARKER = '[cinny-e2e] Thread summary fixture';

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: E2E_USERNAME and E2E_PASSWORD must be set');
  process.exit(1);
}

async function matrixFetch(path, accessToken, options = {}) {
  const url = `${HOMESERVER}/_matrix/client/v3${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const body = await res.json();
  if (!res.ok && body.errcode) {
    const err = new Error(`Matrix API error: ${body.errcode} — ${body.error}`);
    err.errcode = body.errcode;
    err.statusCode = res.status;
    throw err;
  }
  return body;
}

async function login() {
  console.log(`Logging in as ${USERNAME}...`);
  const body = await matrixFetch('/login', null, {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: USERNAME },
      password: PASSWORD,
    }),
  });
  return body.access_token;
}

async function resolveOrCreateRoom(token) {
  // Try to resolve the alias first
  try {
    const alias = encodeURIComponent(ROOM_ALIAS);
    const resolved = await matrixFetch(`/directory/room/${alias}`, token);
    console.log(`Room alias exists: ${resolved.room_id}`);

    // Make sure we're joined
    try {
      await matrixFetch(`/join/${encodeURIComponent(resolved.room_id)}`, token, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch (e) {
      // Already joined is fine
      if (e.errcode !== 'M_ALREADY_JOINED') {
        console.log(`Join note: ${e.message}`);
      }
    }
    return resolved.room_id;
  } catch (e) {
    if (e.errcode !== 'M_NOT_FOUND') throw e;
  }

  // Create the room
  console.log(`Creating room with alias ${ROOM_ALIAS_LOCAL}...`);
  const created = await matrixFetch('/createRoom', token, {
    method: 'POST',
    body: JSON.stringify({
      room_alias_name: ROOM_ALIAS_LOCAL,
      name: 'Cinny E2E Fixture Room',
      topic: 'Automated fixture room for Cinny live e2e tests. Do not delete.',
      preset: 'public_chat',
    }),
  });
  console.log(`Created room: ${created.room_id}`);
  return created.room_id;
}

async function getMessages(token, roomId, limit = 100, maxPages = 20) {
  const messages = [];
  let from;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ dir: 'b', limit: String(limit) });
    if (from) params.set('from', from);

    const result = await matrixFetch(
      `/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
      token
    );
    messages.push(...(result.chunk || []));
    if (!result.end || result.end === from || result.chunk?.length === 0) {
      break;
    }
    from = result.end;
  }

  return messages;
}

function findEventByBody(messages, marker) {
  return messages.find(
    (ev) =>
      ev.type === 'm.room.message' &&
      ev.content &&
      typeof ev.content.body === 'string' &&
      ev.content.body.includes(marker)
  );
}

async function sendEvent(token, roomId, eventType, content) {
  const txnId = `cinny-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await matrixFetch(
    `/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${txnId}`,
    token,
    { method: 'PUT', body: JSON.stringify(content) }
  );
  return result.event_id;
}

async function sendMessage(token, roomId, content) {
  return sendEvent(token, roomId, 'm.room.message', content);
}

async function seedThreadFixture(token, roomId, messages) {
  // Check if thread root already exists
  const existingRoot = findEventByBody(messages, THREAD_ROOT_MARKER);
  if (existingRoot) {
    console.log(`Thread fixture already seeded (root: ${existingRoot.event_id}). Skipping.`);
    return existingRoot.event_id;
  }

  console.log('Sending thread root...');
  const rootId = await sendMessage(token, roomId, {
    msgtype: 'm.text',
    body: `${THREAD_ROOT_MARKER}\n\nThis thread is used for automated e2e testing of thread rendering.`,
  });
  console.log(`  Thread root: ${rootId}`);

  // Send 3 thread replies
  const replies = [
    'Thread reply 1: Testing thread rendering in Cinny.',
    'Thread reply 2: Verifying thread counts update correctly.',
    'Thread reply 3: Final reply to confirm thread navigation works.',
  ];

  for (const [i, body] of replies.entries()) {
    // Small delay to ensure event ordering
    await new Promise((r) => setTimeout(r, 500));
    const replyId = await sendMessage(token, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    console.log(`  Thread reply ${i + 1}: ${replyId}`);
  }

  return rootId;
}

async function seedHiddenThreadRelationFixture(token, roomId, messages) {
  const existingRoot = findEventByBody(messages, HIDDEN_THREAD_RELATION_ROOT_MARKER);
  if (existingRoot) {
    console.log(
      `Hidden threaded metadata fixture already seeded (root: ${existingRoot.event_id}). Skipping.`
    );
    return existingRoot.event_id;
  }

  console.log('Sending hidden-threaded-metadata root...');
  const rootId = await sendMessage(token, roomId, {
    msgtype: 'm.text',
    body: `${HIDDEN_THREAD_RELATION_ROOT_MARKER}\n\nThis root only has hidden threaded metadata relations and should still show 0 replies in the UI.`,
  });
  console.log(`  Hidden relation root: ${rootId}`);

  for (const [index, tagName] of ['alpha', 'beta', 'gamma'].entries()) {
    await new Promise((r) => setTimeout(r, 250));
    const tagEventId = await sendEvent(token, roomId, 'com.mindroom.thread.tag', {
      name: tagName,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
      },
    });
    console.log(`  Hidden relation ${index + 1}: ${tagEventId}`);
  }

  return rootId;
}

async function seedSummaryFixture(token, roomId, messages, rootId) {
  const existingSummary = findEventByBody(messages, SUMMARY_MARKER);
  if (existingSummary) {
    console.log(`Summary fixture already seeded (${existingSummary.event_id}). Skipping.`);
    return;
  }

  console.log('Sending thread summary notice...');
  const content = {
    msgtype: 'm.notice',
    body: `${SUMMARY_MARKER}\n\nThis is a test AI thread summary for e2e validation.`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p><strong>${SUMMARY_MARKER}</strong></p><p>This is a test AI thread summary for e2e validation.</p>`,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: 'Test summary: thread rendering and navigation verified.',
      topic: 'E2E Testing',
      message_count: 4,
    },
  };

  // Associate summary with the thread root so the app renders it as a summary card
  if (rootId) {
    content['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
  }

  const summaryId = await sendMessage(token, roomId, content);
  console.log(`  Summary notice: ${summaryId}`);
}

async function main() {
  const token = await login();
  const roomId = await resolveOrCreateRoom(token);
  const messages = await getMessages(token, roomId);

  const rootId = await seedThreadFixture(token, roomId, messages);
  await seedHiddenThreadRelationFixture(token, roomId, messages);
  await seedSummaryFixture(token, roomId, messages, rootId);

  console.log('\nFixture seeding complete.');
  console.log(`  Room: ${roomId}`);
  console.log(`  Alias: ${ROOM_ALIAS}`);
}

main().catch((err) => {
  console.error('Fixture seeding failed:', err.message);
  process.exit(1);
});
