import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  seedRoomOverviewState,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const FIXTURE_ROOM_ALIAS =
  process.env.E2E_FIXTURE_ROOM_ALIAS ?? '#cinny-e2e-fixture:mindroom.lab.mindroom.chat';
const FIXTURE_ROOM_ID = process.env.E2E_FIXTURE_ROOM_ID;
const FIXTURE_ROOM_REF = FIXTURE_ROOM_ID || FIXTURE_ROOM_ALIAS;
const SUMMARY_TEXT = 'Test summary: thread rendering and navigation verified.';
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('CINNY-029: thread Load Older Messages button', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('short thread should NOT show Load Older Messages button', async ({ page }) => {
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

    await page.goto(`/home/${encodeURIComponent(fixtureRoomId)}`);
    await waitForLoggedInShell(page);

    const threadEntry = page
      .getByRole('button', {
        name: new RegExp(`${escapeRegex(SUMMARY_TEXT)}[\\s\\S]*4 msgs`, 'i'),
      })
      .first();
    await expect(threadEntry).toBeVisible({ timeout: 30_000 });
    await threadEntry.click();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Thread reply 1')).toBeVisible({ timeout: 30_000 });

    const loadOlderButton = page.getByRole('button', { name: 'Load Older Messages' });
    await expect(loadOlderButton).toHaveCount(0);

    await expect(page.getByText('Failed to load this thread')).toHaveCount(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny029');
  });
});
