#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPSTORE_FIXTURE_ROOM_ALIAS,
  APPSTORE_FIXTURE_ROOM_NAME,
  APPSTORE_FIXTURE_ROOM_TOPIC,
  APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME,
  APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH,
  buildAppStoreFixtureThreads,
  buildCanonicalThreadTagStateKey,
  buildScheduledTaskContent,
  buildThreadTagContent,
  getAppStoreFixtureAgentDefinitions,
} from './appstore-fixture.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOMESERVER = process.env.E2E_HOMESERVER || 'http://127.0.0.1:28008';
const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const ROOM_ALIAS = process.env.E2E_FIXTURE_ROOM_ALIAS || APPSTORE_FIXTURE_ROOM_ALIAS;
const ROOM_ALIAS_LOCAL =
  /^#([^:]+):.+$/.exec(ROOM_ALIAS)?.[1] ?? 'mindroom-app-store-personal-showcase';
const SET_PRIMARY_PROFILE = process.env.APPSTORE_FIXTURE_SET_PRIMARY_PROFILE ?? '1';

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: E2E_USERNAME and E2E_PASSWORD must be set');
  process.exit(1);
}

const log = (message) => {
  console.error(message);
};

const sleep = (ms) =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

const parseJsonResponse = async (response, url) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Matrix API returned non-JSON for ${url}: ${text.slice(0, 200)}`);
  }
};

async function matrixFetch(path, accessToken, options = {}) {
  const url = `${HOMESERVER}/_matrix/client/v3${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });
  const body = await parseJsonResponse(response, url);
  if (!response.ok && body.errcode) {
    const error = new Error(`Matrix API error: ${body.errcode} - ${body.error}`);
    error.errcode = body.errcode;
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Matrix API error: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function uploadMedia(accessToken, data, contentType, filename) {
  const uploadBases = ['/_matrix/media/v3', '/_matrix/media/r0'];
  let lastError;

  for (const uploadBase of uploadBases) {
    try {
      const url = `${HOMESERVER}${uploadBase}/upload?filename=${encodeURIComponent(filename)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': contentType,
        },
        body: data,
      });
      const body = await parseJsonResponse(response, url);
      if (response.ok && typeof body.content_uri === 'string') {
        return body.content_uri;
      }

      lastError = body.errcode ? `${body.errcode} - ${body.error}` : `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`Matrix media upload failed: ${lastError ?? 'unknown error'}`);
}

async function login(username, password) {
  return matrixFetch('/login', null, {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
      initial_device_display_name: 'MindRoom App Store Fixture',
    }),
  });
}

async function registerWithDummyAuth(username, password) {
  const initial = {
    username,
    password,
    initial_device_display_name: 'MindRoom App Store Fixture',
  };

  try {
    return await matrixFetch('/register', null, {
      method: 'POST',
      body: JSON.stringify(initial),
    });
  } catch (error) {
    if (error.errcode === 'M_USER_IN_USE') {
      return login(username, password);
    }
    if (error.statusCode !== 401) {
      throw error;
    }

    const challenge = error.body ?? {};
    const session = challenge.session;
    const flows = Array.isArray(challenge.flows) ? challenge.flows : [];
    const supportsDummyAuth = flows.some((flow) => {
      const stages = Array.isArray(flow.stages) ? flow.stages : [];
      return stages.includes('m.login.dummy');
    });

    if (!session || !supportsDummyAuth) {
      throw error;
    }

    return matrixFetch('/register', null, {
      method: 'POST',
      body: JSON.stringify({
        ...initial,
        auth: {
          type: 'm.login.dummy',
          session,
        },
      }),
    });
  }
}

async function setDisplayName(accessToken, userId, displayName) {
  await matrixFetch(`/profile/${encodeURIComponent(userId)}/displayname`, accessToken, {
    method: 'PUT',
    body: JSON.stringify({ displayname: displayName }),
  });
}

async function setAvatarUrl(accessToken, userId, avatarUrl) {
  await matrixFetch(`/profile/${encodeURIComponent(userId)}/avatar_url`, accessToken, {
    method: 'PUT',
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
}

const contentTypeForPath = (path) => {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
};

async function setUserAvatar(accessToken, userId, avatarAssetPath) {
  const absolutePath = resolve(ROOT_DIR, avatarAssetPath);
  const data = await readFile(absolutePath);
  const avatarUrl = await uploadMedia(
    accessToken,
    data,
    contentTypeForPath(avatarAssetPath),
    avatarAssetPath.split('/').pop() ?? 'avatar.png'
  );
  await setAvatarUrl(accessToken, userId, avatarUrl);
  return avatarUrl;
}

async function ensureFixtureUser({ username, password, displayName, avatarAssetPath }) {
  let session;
  try {
    session = await login(username, password);
  } catch {
    session = await registerWithDummyAuth(username, password);
  }

  let avatarUrl;
  if (avatarAssetPath) {
    avatarUrl = await setUserAvatar(session.access_token, session.user_id, avatarAssetPath);
  }
  await setDisplayName(session.access_token, session.user_id, displayName);

  return {
    accessToken: session.access_token,
    userId: session.user_id,
    username,
    displayName,
    avatarUrl,
  };
}

async function sendStateEvent(accessToken, roomId, eventType, stateKey, content) {
  await matrixFetch(
    `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
      eventType
    )}/${encodeURIComponent(stateKey)}`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(content),
    }
  );
}

async function grantStatePower(accessToken, roomId, userId) {
  const path = `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`;
  const powers = await matrixFetch(path, accessToken);
  await matrixFetch(path, accessToken, {
    method: 'PUT',
    body: JSON.stringify({ ...powers, users: { ...powers.users, [userId]: 50 } }),
  });
}

async function updateMemberProfile(session, roomId) {
  await sendStateEvent(session.accessToken, roomId, 'm.room.member', session.userId, {
    membership: 'join',
    displayname: session.displayName,
    ...(session.avatarUrl ? { avatar_url: session.avatarUrl } : {}),
  }).catch((error) => {
    log(`Could not refresh ${session.displayName} room avatar: ${error.message}`);
  });
}

async function joinRoom(accessToken, roomIdOrAlias) {
  const result = await matrixFetch(`/join/${encodeURIComponent(roomIdOrAlias)}`, accessToken, {
    method: 'POST',
    body: JSON.stringify({}),
  }).catch((error) => {
    if (error.errcode !== 'M_ALREADY_JOINED') throw error;
    return { room_id: roomIdOrAlias };
  });

  return result.room_id;
}

async function resolveOrCreateRoom(accessToken) {
  try {
    const resolved = await matrixFetch(
      `/directory/room/${encodeURIComponent(ROOM_ALIAS)}`,
      accessToken
    );
    log(`Room alias exists: ${resolved.room_id}`);
    await joinRoom(accessToken, resolved.room_id);
    await sendStateEvent(accessToken, resolved.room_id, 'm.room.name', '', {
      name: APPSTORE_FIXTURE_ROOM_NAME,
    });
    await sendStateEvent(accessToken, resolved.room_id, 'm.room.topic', '', {
      topic: APPSTORE_FIXTURE_ROOM_TOPIC,
    });
    return resolved.room_id;
  } catch (error) {
    if (error.errcode !== 'M_NOT_FOUND') throw error;
  }

  log(`Creating App Store screenshot room with alias ${ROOM_ALIAS_LOCAL}...`);
  const created = await matrixFetch('/createRoom', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      room_alias_name: ROOM_ALIAS_LOCAL,
      name: APPSTORE_FIXTURE_ROOM_NAME,
      topic: APPSTORE_FIXTURE_ROOM_TOPIC,
      preset: 'public_chat',
    }),
  });
  log(`Created room: ${created.room_id}`);
  return created.room_id;
}

async function getMessages(accessToken, roomId, limit = 500) {
  const params = new URLSearchParams({ dir: 'b', limit: String(limit) });
  const result = await matrixFetch(
    `/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    accessToken
  );
  return result.chunk || [];
}

function findMessageByBody(messages, body) {
  return messages.find(
    (event) =>
      event.type === 'm.room.message' &&
      typeof event.content?.body === 'string' &&
      event.content.body.includes(body)
  );
}

async function sendEvent(accessToken, roomId, eventType, content) {
  const txnId = `appstore-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await matrixFetch(
    `/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${txnId}`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(content),
    }
  );
  return result.event_id;
}

async function sendMessage(accessToken, roomId, content) {
  return sendEvent(accessToken, roomId, 'm.room.message', content);
}

const withThreadRelation = (content, rootId) => ({
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

async function seedThread({ accessToken, roomId, thread, messages, senders, primaryUserId }) {
  const existingRoot = findMessageByBody(messages, thread.root.body);
  let rootId = existingRoot?.event_id;
  if (rootId) {
    log(`Thread already seeded: ${thread.root.body}`);
  } else {
    log(`Seeding thread: ${thread.root.body}`);
    rootId = await sendMessage(
      senders[thread.root.sender].accessToken,
      roomId,
      thread.root.content
    );
    await sleep(250);
  }

  for (const reply of thread.replies) {
    if (!findMessageByBody(messages, reply.content.body)) {
      await sendMessage(
        senders[reply.sender].accessToken,
        roomId,
        withThreadRelation(reply.content, rootId)
      );
      await sleep(250);
    }
  }

  if (thread.summary && !findMessageByBody(messages, thread.summary.content.body)) {
    await sendMessage(
      senders[thread.summary.sender].accessToken,
      roomId,
      withThreadRelation(thread.summary.content, rootId)
    );
    await sleep(250);
  }

  for (const tagName of thread.tags ?? []) {
    await sendStateEvent(
      accessToken,
      roomId,
      'com.mindroom.thread.tags',
      buildCanonicalThreadTagStateKey(rootId, tagName),
      buildThreadTagContent(primaryUserId)
    );
  }

  if (thread.scheduledAt) {
    // The client lists only scheduled tasks a MindRoom account wrote, as the backend runs only those.
    await sendStateEvent(
      senders[thread.summary.sender].accessToken,
      roomId,
      'com.mindroom.scheduled.task',
      `appstore-fixture-${thread.id}`,
      buildScheduledTaskContent(rootId, thread.scheduledAt)
    );
  }

  return rootId;
}

async function main() {
  log(`Logging in as ${USERNAME}...`);
  const primarySessionRaw = await login(USERNAME, PASSWORD);
  const primarySession = {
    accessToken: primarySessionRaw.access_token,
    userId: primarySessionRaw.user_id,
    username: USERNAME,
    displayName: APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME,
  };

  if (SET_PRIMARY_PROFILE === '1') {
    primarySession.avatarUrl = await setUserAvatar(
      primarySession.accessToken,
      primarySession.userId,
      APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH
    );
    await setDisplayName(
      primarySession.accessToken,
      primarySession.userId,
      primarySession.displayName
    );
  }

  const agentSessions = {};
  for (const agent of getAppStoreFixtureAgentDefinitions()) {
    agentSessions[agent.key] = await ensureFixtureUser(agent);
  }

  const roomId = await resolveOrCreateRoom(primarySession.accessToken);
  if (SET_PRIMARY_PROFILE === '1') {
    await updateMemberProfile(primarySession, roomId);
  }

  for (const session of Object.values(agentSessions)) {
    await joinRoom(session.accessToken, roomId);
    await updateMemberProfile(session, roomId);
    await grantStatePower(primarySession.accessToken, roomId, session.userId);
  }

  const senders = {
    primary: primarySession,
    ...agentSessions,
  };

  const threads = buildAppStoreFixtureThreads();

  const messages = await getMessages(primarySession.accessToken, roomId);
  for (const thread of threads) {
    await seedThread({
      accessToken: primarySession.accessToken,
      roomId,
      thread,
      messages,
      senders,
      primaryUserId: primarySession.userId,
    });
  }

  log('\nApp Store screenshot fixture ready.');
  log(`  Room: ${roomId}`);
  log(`  Alias: ${ROOM_ALIAS}`);
  log(
    `  Agents: ${Object.values(agentSessions)
      .map((agent) => agent.displayName)
      .join(', ')}`
  );
}

main().catch((error) => {
  console.error('App Store screenshot fixture seeding failed:', error.message);
  process.exit(1);
});
