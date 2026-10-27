import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, webkit } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
} from '../helpers/matrix';

declare global {
  interface Window {
    __loseIndexedDbConnections?: () => string[];
  }
}

/**
 * WebKit hosts IndexedDB in its networking process. When that process exits,
 * every open connection in the page closes and fires `close`, while later
 * `indexedDB.open` calls work again. Record connections so the test can
 * reproduce that loss.
 */
const installIndexedDbLoss = () => {
  const nativeOpen = IDBFactory.prototype.open;
  const nativeTransaction = IDBDatabase.prototype.transaction;
  const connections = new Set<IDBDatabase>();
  const transactions = new Set<IDBTransaction>();
  // WebKit aborts every active transaction of a lost connection.
  IDBDatabase.prototype.transaction = function transaction(this: IDBDatabase, ...args) {
    const created = nativeTransaction.apply(this, args);
    transactions.add(created);
    const settle = () => transactions.delete(created);
    created.addEventListener('complete', settle);
    created.addEventListener('abort', settle);
    created.addEventListener('error', settle);
    return created;
  } as typeof IDBDatabase.prototype.transaction;
  IDBFactory.prototype.open = function open(this: IDBFactory, ...args) {
    const request = nativeOpen.apply(this, args);
    request.addEventListener('success', () => {
      const connection = request.result;
      connections.add(connection);
      connection.addEventListener('close', () => connections.delete(connection));
    });
    return request;
  } as typeof IDBFactory.prototype.open;
  window.__loseIndexedDbConnections = () => {
    const lost = Array.from(connections);
    connections.clear();
    Array.from(transactions).forEach((active) => {
      try {
        active.abort();
      } catch {
        // Already finished.
      }
    });
    transactions.clear();
    lost.forEach((connection) => {
      connection.close();
      connection.dispatchEvent(new Event('close'));
    });
    return lost.map((connection) => connection.name);
  };
};

const blockIndexedDbLossSentinel = () => {
  const nativeOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function open(this: IDBFactory, name: string, ...args) {
    if (name === 'mindroom-indexeddb-sentinel-v1')
      throw new DOMException('blocked', 'SecurityError');
    return nativeOpen.call(this, name, ...args);
  } as typeof IDBFactory.prototype.open;
};

// The Matrix SDK's sync store and Rust crypto store must be among the lost connections.
const expectMatrixStoresLost = (lost: string[]) => {
  expect(lost).toEqual(
    expect.arrayContaining([
      expect.stringContaining('web-sync-store'),
      expect.stringContaining('matrix-sdk-crypto'),
    ])
  );
};

// WebKit networking processes ("WebKitNetworkProcess", truncated by `ps`) that
// this worker started, so other browsers on the same host are left alone.
const findOwnWebKitNetworkProcesses = (): number[] => {
  try {
    const rows = execSync('ps -eo pid,ppid,comm', { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields.length >= 3);
    const parents = new Map(rows.map(([pid, ppid]) => [Number(pid), Number(ppid)]));
    const descendsFromWorker = (pid: number): boolean => {
      for (let current = parents.get(pid); current; current = parents.get(current)) {
        if (current === process.pid) return true;
      }
      return false;
    };
    return rows
      .filter(([, , comm]) => /NetworkProce/.test(comm))
      .map(([pid]) => Number(pid))
      .filter(descendsFromWorker);
  } catch {
    return [];
  }
};

const threadReply = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

test.describe('thread live updates after IndexedDB connection loss', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(240_000);

  for (const recovery of ['reload', 'no reload'] as const) {
    test(`renders a reply that shares its sync response with a to-device message (${recovery})`, async ({
      browserName,
      page,
    }) => {
      // Playwright WebKit reports these /sync requests but never routes them.
      test.skip(browserName === 'webkit', 'WebKit does not route the client /sync requests');
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const stamp = Date.now();
      const fixture = await createThreadFixture(homeserver, session.accessToken, {
        name: `IndexedDB loss batch ${stamp}`,
        topic: 'Sync responses after WebKit networking-process loss',
        rootBody: `IndexedDB loss batch root ${stamp}`,
        replyBody: `Reply before IndexedDB loss batch ${stamp}`,
      });

      // While held, /sync responses are replaced by a server error, so the
      // client retries from the same token and the next response carries
      // every event sent meanwhile in one batch.
      let holdSync = false;
      let heldSyncs = 0;
      await page.route(/\/_matrix\/client\/v3\/sync(\?|$)/, async (route) => {
        const response = await route.fetch().catch(() => undefined);
        if (!response) {
          await route.abort().catch(() => undefined);
          return;
        }
        if (holdSync) {
          heldSyncs += 1;
          await route
            .fulfill({ status: 502, contentType: 'application/json', body: '{}' })
            .catch(() => undefined);
          return;
        }
        await route.fulfill({ response }).catch(() => undefined);
      });
      await page.addInitScript(installIndexedDbLoss);
      // Without the loss sentinel the page never reloads, so only the Matrix
      // SDK's own handling of the failed crypto store can deliver the reply.
      if (recovery === 'no reload') await page.addInitScript(blockIndexedDbLossSentinel);
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.goto(
        `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
      );
      await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toContainText(
        fixture.replyBody,
        { timeout: 60_000 }
      );
      await page.waitForTimeout(2_000);

      let loads = 0;
      page.on('load', () => {
        loads += 1;
      });
      holdSync = true;
      const lost = await page.evaluate(() => window.__loseIndexedDbConnections?.() ?? []);
      expectMatrixStoresLost(lost);
      if (recovery === 'reload') {
        // The Rust crypto store cannot reopen; recovery reloads the page.
        await expect.poll(() => loads, { timeout: 15_000 }).toBeGreaterThan(0);
      }

      await matrixFetch(
        homeserver,
        `/sendToDevice/org.mindroom.test.ping/${encodeURIComponent(`idb-loss-${stamp}`)}`,
        {
          method: 'PUT',
          accessToken: session.accessToken,
          body: JSON.stringify({ messages: { [session.userId]: { '*': { stamp } } } }),
        }
      );
      const replyBody = `Reply sharing a to-device batch ${stamp}`;
      const replyId = await sendRoomMessage(
        homeserver,
        session.accessToken,
        fixture.roomId,
        threadReply(fixture.rootId, replyBody)
      );
      // The in-flight long poll returns for the new data and is replaced.
      await expect.poll(() => heldSyncs, { timeout: 40_000 }).toBeGreaterThan(0);
      holdSync = false;

      // Without the reload, the SDK applies the response after about a minute of retries.
      await expect(page.locator(`[data-message-id="${replyId}"]`)).toContainText(replyBody, {
        timeout: recovery === 'reload' ? 30_000 : 90_000,
      });
      if (recovery === 'no reload') expect(loads).toBe(0);
    });
  }

  test('renders a reply that arrives after every existing connection closes', async ({ page }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `IndexedDB loss ${stamp}`,
      topic: 'Open thread live updates after WebKit networking-process loss',
      rootBody: `IndexedDB loss root ${stamp}`,
      replyBody: `Reply before IndexedDB loss ${stamp}`,
    });

    await page.addInitScript(installIndexedDbLoss);
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(
      `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
    );
    await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toContainText(
      fixture.replyBody,
      { timeout: 60_000 }
    );
    // Let opening settle so the loss hits a thread idling on live sync.
    await page.waitForTimeout(2_000);

    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    const lost = await page.evaluate(() => window.__loseIndexedDbConnections?.() ?? []);
    expectMatrixStoresLost(lost);
    await expect.poll(() => loads, { timeout: 15_000 }).toBeGreaterThan(0);

    for (let index = 1; index <= 2; index += 1) {
      const replyBody = `Reply ${index} after IndexedDB loss ${stamp}`;
      // eslint-disable-next-line no-await-in-loop -- replies must arrive in order.
      const replyId = await sendRoomMessage(
        homeserver,
        session.accessToken,
        fixture.roomId,
        threadReply(fixture.rootId, replyBody)
      );
      // eslint-disable-next-line no-await-in-loop -- each reply must render live.
      await expect(page.locator(`[data-message-id="${replyId}"]`)).toContainText(replyBody, {
        timeout: 20_000,
      });
    }
  });

  test('recovers when WebKit really kills its networking process', async ({ browserName }) => {
    test.skip(browserName !== 'webkit', 'Only WebKit hosts IndexedDB in a networking process');
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `Networking process kill ${stamp}`,
      topic: 'Recovery after WebKit networking-process exit',
      rootBody: `Networking process kill root ${stamp}`,
      replyBody: `Reply before networking process kill ${stamp}`,
    });
    // A persistent profile, like the app's: an ephemeral one also loses the
    // Web Storage (and with it the login) written before the kill.
    const profile = mkdtempSync(join(tmpdir(), 'idb-loss-'));
    const existing = new Set(findOwnWebKitNetworkProcesses());
    const context = await webkit.launchPersistentContext(profile, {
      baseURL: test.info().project.use.baseURL,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.goto(
        `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
      );
      await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toContainText(
        fixture.replyBody,
        { timeout: 60_000 }
      );
      await page.waitForTimeout(2_000);
      let loads = 0;
      page.on('load', () => {
        loads += 1;
      });

      // Only the networking process of the persistent context launched above.
      const pids = findOwnWebKitNetworkProcesses().filter((pid) => !existing.has(pid));
      test.skip(pids.length === 0, 'No WebKit networking process visible to this runner');
      pids.forEach((pid) => process.kill(pid, 'SIGKILL'));

      await expect.poll(() => loads, { timeout: 15_000 }).toBeGreaterThan(0);
      // The reload guard was written after the loss and survives the reload.
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('mindroom.indexedDbLoss.reloadAt.v1')))
        .not.toBeNull();
      const replyBody = `Reply after networking process kill ${stamp}`;
      const replyId = await sendRoomMessage(
        homeserver,
        session.accessToken,
        fixture.roomId,
        threadReply(fixture.rootId, replyBody)
      );
      await expect(page.locator(`[data-message-id="${replyId}"]`)).toContainText(replyBody, {
        timeout: 60_000,
      });
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
});
