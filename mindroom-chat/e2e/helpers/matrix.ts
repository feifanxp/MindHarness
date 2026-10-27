import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

export type MatrixSession = {
  accessToken: string;
  userId: string;
};

export type ThreadFixture = {
  roomId: string;
  rootId: string;
  replyId: string;
  rootBody: string;
  replyBody: string;
};

type MatrixFetchOptions = RequestInit & {
  accessToken?: string;
  apiVersion?: 'v1' | 'v3';
};

type CreateRoomOptions = {
  name: string;
  topic: string;
  preset?: 'private_chat' | 'trusted_private_chat';
  invite?: string[];
  isDirect?: boolean;
  creationContent?: Record<string, unknown>;
};

type CreateThreadFixtureOptions = {
  name: string;
  topic: string;
  rootBody: string;
  replyBody: string;
  fillerBody?: string;
  preset?: 'private_chat' | 'trusted_private_chat';
  invite?: string[];
  isDirect?: boolean;
  txnPrefix?: string;
};

type SerializedThreadFilterState = {
  v: 1;
  resolved: 'any' | 'include' | 'exclude';
  streaming: 'any' | 'include' | 'exclude';
  scheduled: 'any' | 'include' | 'exclude';
  unread: 'any' | 'include' | 'exclude';
  idle: 'any' | 'include' | 'exclude';
  sortBy: 'natural' | 'lastReply';
  sortDirection: 'asc' | 'desc';
  tags: Record<string, 'include' | 'exclude'>;
  searchQuery: string;
  statusMode: 'and' | 'or';
};

type SeedRoomOverviewStateOptions = {
  page: Page;
  roomId: string;
  userId: string;
  viewMode?: 'threaded' | 'compact' | 'classic' | 'normal';
  filterState?: SerializedThreadFilterState;
};

type SeedRoomOverviewStorageInput = {
  nextRoomId: string;
  nextUserId: string;
  nextViewMode: 'threaded' | 'compact' | 'classic' | 'normal';
  nextFilterState: SerializedThreadFilterState;
};

const seedRoomOverviewStateInStorage = ({
  nextRoomId,
  nextUserId,
  nextViewMode,
  nextFilterState,
}: SeedRoomOverviewStorageInput) => {
  const setStoredValue = (key: string, nextValue: string) => {
    const oldValue = localStorage.getItem(key);
    localStorage.setItem(key, nextValue);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key,
        oldValue,
        newValue: nextValue,
        storageArea: localStorage,
      })
    );
  };
  const getActiveSession = (): { sessionId?: string; userId?: string } => {
    const rawStore = localStorage.getItem('mindroom_multi_account_store');
    if (!rawStore) return {};

    try {
      const store = JSON.parse(rawStore) as {
        activeSessionId?: unknown;
        sessions?: Array<{ sessionId?: unknown; userId?: unknown }>;
      };
      const sessions = Array.isArray(store.sessions) ? store.sessions : [];
      const activeSession = sessions.find(
        (session) =>
          typeof session.sessionId === 'string' && session.sessionId === store.activeSessionId
      );

      return {
        sessionId:
          typeof activeSession?.sessionId === 'string' ? activeSession.sessionId : undefined,
        userId: typeof activeSession?.userId === 'string' ? activeSession.userId : undefined,
      };
    } catch {
      return {};
    }
  };

  const activeSession = getActiveSession();
  if (activeSession.sessionId) {
    setStoredValue(
      `roomViewMode:${activeSession.sessionId}:${nextRoomId}`,
      JSON.stringify(nextViewMode)
    );
  } else {
    setStoredValue(`roomViewMode:${nextRoomId}`, JSON.stringify(nextViewMode));
  }

  const userIds = new Set([nextUserId, activeSession.userId].filter(Boolean));
  userIds.forEach((userId) => {
    setStoredValue(`roomThreadFilter:${userId}:${nextRoomId}`, JSON.stringify(nextFilterState));
  });
};

export const matrixFetch = async <T>(
  homeserver: string,
  path: string,
  options: MatrixFetchOptions = {}
): Promise<T> => {
  const { accessToken, apiVersion = 'v3', headers, ...rest } = options;
  const response = await fetch(`${homeserver}/_matrix/client/${apiVersion}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const error = [body.errcode, body.error].filter(Boolean).join(' ');
    throw new Error(`Matrix API ${response.status} for ${path}: ${error || 'unknown error'}`);
  }

  return body as T;
};

export const loginToMatrix = async (
  homeserver: string,
  username: string,
  password: string
): Promise<MatrixSession> => {
  const body = await matrixFetch<{ access_token: string; user_id: string }>(homeserver, '/login', {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });

  return {
    accessToken: body.access_token,
    userId: body.user_id,
  };
};

/**
 * Registers a disposable MindRoom agent account. The client trusts MindRoom protocol events
 * (approval cards, scheduled tasks) only from `mindroom_` accounts on the viewer's homeserver.
 * Needs a server with open registration, such as the disposable e2e stack.
 */
export const registerAgentAccount = async (
  homeserver: string,
  name: string
): Promise<MatrixSession> => {
  const body = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({
        username: `mindroom_${name}_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        password: randomUUID(),
        auth: { type: 'm.login.dummy' },
      }),
    }
  );
  return { accessToken: body.access_token, userId: body.user_id };
};

export const createPrivateRoom = async (
  homeserver: string,
  accessToken: string,
  options: CreateRoomOptions
): Promise<string> => {
  const body = await matrixFetch<{ room_id: string }>(homeserver, '/createRoom', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      name: options.name,
      topic: options.topic,
      preset: options.preset ?? 'private_chat',
      invite: options.invite,
      is_direct: options.isDirect,
      creation_content: options.creationContent,
    }),
  });

  return body.room_id;
};

export const createPrivateSpace = async (
  homeserver: string,
  accessToken: string,
  options: Omit<CreateRoomOptions, 'creationContent'>
): Promise<string> =>
  createPrivateRoom(homeserver, accessToken, {
    ...options,
    creationContent: {
      type: 'm.space',
    },
  });

export const createThreadFixture = async (
  homeserver: string,
  accessToken: string,
  options: CreateThreadFixtureOptions
): Promise<ThreadFixture> => {
  const roomId = await createPrivateRoom(homeserver, accessToken, {
    name: options.name,
    topic: options.topic,
    preset: options.preset,
    invite: options.invite,
    isDirect: options.isDirect,
  });
  const txnPrefix = options.txnPrefix ?? 'cinny-e2e';

  if (options.fillerBody) {
    await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: options.fillerBody,
      },
      txnPrefix
    );
  }

  const rootId = await sendRoomMessage(
    homeserver,
    accessToken,
    roomId,
    {
      msgtype: 'm.text',
      body: options.rootBody,
    },
    txnPrefix
  );

  const replyId = await sendRoomMessage(
    homeserver,
    accessToken,
    roomId,
    {
      msgtype: 'm.text',
      body: options.replyBody,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    },
    txnPrefix
  );

  return {
    roomId,
    rootId,
    replyId,
    rootBody: options.rootBody,
    replyBody: options.replyBody,
  };
};

export const joinRoom = async (
  homeserver: string,
  accessToken: string,
  roomIdOrAlias: string
): Promise<string> => {
  const body = await matrixFetch<{ room_id: string }>(
    homeserver,
    `/join/${encodeURIComponent(roomIdOrAlias)}`,
    {
      method: 'POST',
      accessToken,
      body: JSON.stringify({}),
    }
  );

  return body.room_id;
};

export const sendRoomMessage = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  content: Record<string, unknown>,
  txnPrefix = 'cinny-e2e'
): Promise<string> => {
  const txnId = `${txnPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await matrixFetch<{ event_id: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify(content),
    }
  );

  return body.event_id;
};

export const sendMessageEdit = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  targetEventId: string,
  newBody: string,
  txnPrefix = 'cinny-e2e-edit'
): Promise<string> => {
  const txnId = `${txnPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await matrixFetch<{ event_id: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify({
        msgtype: 'm.text',
        body: `* ${newBody}`,
        'm.new_content': {
          msgtype: 'm.text',
          body: newBody,
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: targetEventId,
        },
      }),
    }
  );

  return body.event_id;
};

export const redactEvent = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  eventId: string,
  reason?: string,
  txnPrefix = 'cinny-e2e-redact'
): Promise<string> => {
  const txnId = `${txnPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await matrixFetch<{ event_id: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${txnId}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify(reason ? { reason } : {}),
    }
  );

  return body.event_id;
};

export const sendReaction = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  eventId: string,
  key: string,
  txnPrefix = 'cinny-e2e-reaction'
): Promise<string> => {
  const txnId = `${txnPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await matrixFetch<{ event_id: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnId}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify({
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: eventId,
          key,
        },
      }),
    }
  );

  return body.event_id;
};

export const sendStateEvent = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  eventType: string,
  stateKey: string,
  content: Record<string, unknown>
) => {
  await matrixFetch<unknown>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
      eventType
    )}/${encodeURIComponent(stateKey)}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify(content),
    }
  );
};

export const addRoomToSpace = async (
  homeserver: string,
  accessToken: string,
  spaceId: string,
  roomId: string
) => {
  const via = new URL(homeserver).host;
  const content = { via: [via] };

  await sendStateEvent(homeserver, accessToken, spaceId, 'm.space.child', roomId, content);
  await sendStateEvent(homeserver, accessToken, roomId, 'm.space.parent', spaceId, content);
};

export const setAccountData = async (
  homeserver: string,
  accessToken: string,
  userId: string,
  eventType: string,
  content: Record<string, unknown>
) => {
  await matrixFetch<unknown>(
    homeserver,
    `/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(eventType)}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify(content),
    }
  );
};

export const setDirectAccountData = async (
  homeserver: string,
  accessToken: string,
  userId: string,
  otherUserId: string,
  roomId: string
) => {
  await setAccountData(homeserver, accessToken, userId, 'm.direct', {
    [otherUserId]: [roomId],
  });
};

export const createDefaultThreadFilterState = (): SerializedThreadFilterState => ({
  v: 1,
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'lastReply',
  sortDirection: 'desc',
  tags: {},
  searchQuery: '',
  statusMode: 'and',
});

export const createHiddenOverviewFilterState = (): SerializedThreadFilterState => ({
  ...createDefaultThreadFilterState(),
  resolved: 'include',
});

export const seedRoomOverviewState = async ({
  page,
  roomId,
  userId,
  viewMode = 'threaded',
  filterState = createHiddenOverviewFilterState(),
}: SeedRoomOverviewStateOptions) => {
  const storageInput: SeedRoomOverviewStorageInput = {
    nextRoomId: roomId,
    nextUserId: userId,
    nextViewMode: viewMode,
    nextFilterState: filterState,
  };

  await page.addInitScript(seedRoomOverviewStateInStorage, storageInput);
  await page.evaluate(seedRoomOverviewStateInStorage, storageInput);
};
