import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  seedRoomOverviewState,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const FIXTURE_ROOM_ALIAS =
  process.env.E2E_FIXTURE_ROOM_ALIAS ?? '#cinny-e2e-fixture:mindroom.lab.mindroom.chat';
const FIXTURE_ROOM_ID = process.env.E2E_FIXTURE_ROOM_ID;
const FIXTURE_ROOM_REF = FIXTURE_ROOM_ID || FIXTURE_ROOM_ALIAS;
const HIDDEN_THREAD_RELATION_ROOT_MARKER = '[cinny-e2e] Hidden relation thread root';
const SUMMARY_TEXT = 'Test summary: thread rendering and navigation verified.';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Navigate directly to the seeded fixture room.
 */
async function navigateToFixtureRoom(
  page: import('@playwright/test').Page,
  roomIdOrAlias: string
): Promise<boolean> {
  await page.goto(`/home/${encodeURIComponent(roomIdOrAlias)}`);
  await waitForLoggedInShell(page);
  return true;
}

const getOverviewThreadButtons = (page: import('@playwright/test').Page) =>
  page.locator('button[aria-label^="Open thread:"]');

const getNewestMatchingThreadButton = (page: import('@playwright/test').Page, name: RegExp) =>
  page.getByRole('button', { name }).first();

const getMessageComposer = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox').first();

test.describe('live threads', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('thread overview panel visible in fixture room', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const fixtureRoomId = await joinRoom(homeserver, session.accessToken, FIXTURE_ROOM_REF);

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId: fixtureRoomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const found = await navigateToFixtureRoom(page, fixtureRoomId);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    // Look for thread overview panel or thread indicators in the room
    const threadOverview = page.locator('[data-room-thread-overview="true"]');
    const threadIndicators = page.locator('[class*="thread"], [class*="Thread"]');

    // Either the overview panel or thread indicators should be visible
    const hasThreadUI = (await threadOverview.count()) > 0 || (await threadIndicators.count()) > 0;

    expect(hasThreadUI).toBe(true);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-overview');
  });

  test('thread counts are numeric (not loading placeholders)', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const fixtureRoomId = await joinRoom(homeserver, session.accessToken, FIXTURE_ROOM_REF);

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId: fixtureRoomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const found = await navigateToFixtureRoom(page, fixtureRoomId);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    const threadButtons = getOverviewThreadButtons(page);
    await expect(threadButtons.first()).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const labels = await threadButtons.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('aria-label') ?? '')
          );
          return labels.some((label) => /\b\d+\s(?:replies|msgs)\b/i.test(label));
        },
        { timeout: 30_000, message: 'Thread counts should settle to numeric values' }
      )
      .toBe(true);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-counts');
  });

  test('thread navigation works (click into thread, messages render)', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const fixtureRoomId = await joinRoom(homeserver, session.accessToken, FIXTURE_ROOM_REF);

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId: fixtureRoomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const found = await navigateToFixtureRoom(page, fixtureRoomId);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    const threadEntry = getNewestMatchingThreadButton(
      page,
      new RegExp(`${escapeRegex(SUMMARY_TEXT)}[\\s\\S]*4 msgs`, 'i')
    );
    await expect(threadEntry).toBeVisible({ timeout: 30_000 });
    await threadEntry.click();

    // After clicking, verify thread-specific content renders (not just room-level messages)
    const threadPanel = page.locator(
      '[class*="ThreadView"], [class*="thread-panel"], [class*="ThreadPanel"]'
    );
    // Look for known fixture thread reply text to prove we're inside the thread
    const threadReplyContent = page.getByText('Thread reply 1');

    await expect
      .poll(
        async () => {
          const panelVisible = (await threadPanel.count()) > 0;
          const replyVisible = (await threadReplyContent.count()) > 0;
          return panelVisible || replyVisible;
        },
        {
          timeout: 30_000,
          message: 'Thread-specific content should render after clicking thread entry',
        }
      )
      .toBe(true);

    // Verify no "Failed to load this thread" error
    await expect(page.getByText('Failed to load this thread')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-navigation');
  });

  test('sending a new root in compact view opens its thread and keeps a zero-reply card on return', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `CINNY-068 ${stamp}`,
      topic: 'Regression fixture for compact zero-reply root creation',
    });
    const rootBody = `CINNY-068 compact zero-reply root ${stamp}`;

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await waitForLoggedInShell(page);

    const composer = getMessageComposer(page);
    await composer.click();
    await composer.fill(rootBody);
    await composer.press('Enter');

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId')?.startsWith('$'), {
        timeout: 30_000,
      })
      .toBe(true);
    const canonicalRootId = new URL(page.url()).searchParams.get('threadId');
    await page.goto('/home/' + encodeURIComponent(roomId));
    await waitForLoggedInShell(page);

    const compactThreadButton = page
      .locator('[data-compact-room-view="true"]')
      .locator('[data-thread-root-id="' + canonicalRootId + '"]');
    await expect(compactThreadButton).toBeVisible({ timeout: 30_000 });
    await expect(compactThreadButton).toContainText(rootBody);
    await expect(compactThreadButton).toHaveAccessibleName(/\b0 replies\b/);

    await compactThreadButton.click();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Failed to load this thread')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'compact-zero-reply-root');
  });

  test('hidden threaded metadata relations do not inflate visible reply counts', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const fixtureRoomId = await joinRoom(homeserver, session.accessToken, FIXTURE_ROOM_REF);

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId: fixtureRoomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const found = await navigateToFixtureRoom(page, fixtureRoomId);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    const hiddenRelationThreadButton = getNewestMatchingThreadButton(
      page,
      new RegExp(`${escapeRegex(HIDDEN_THREAD_RELATION_ROOT_MARKER)}[\\s\\S]*0 replies`, 'i')
    );
    await expect(hiddenRelationThreadButton).toBeVisible({ timeout: 30_000 });

    await hiddenRelationThreadButton.click();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(HIDDEN_THREAD_RELATION_ROOT_MARKER).last()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('com.mindroom.thread.tag')).toHaveCount(0);
    await expect(page.getByText('Thread reply 1')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'hidden-threaded-metadata-count');
  });

  test('summary card renders with expected content', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const fixtureRoomId = await joinRoom(homeserver, session.accessToken, FIXTURE_ROOM_REF);

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId: fixtureRoomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const found = await navigateToFixtureRoom(page, fixtureRoomId);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    const summaryCard = page.getByText(SUMMARY_TEXT).first();
    await expect(summaryCard).toBeVisible({ timeout: 30_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'summary-card');
  });
});
