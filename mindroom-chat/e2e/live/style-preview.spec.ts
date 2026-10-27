import { test } from '@playwright/test';

const HOMESERVER = process.env.E2E_HOMESERVER || 'https://mindroom.lab.mindroom.chat';
const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const ROOM_ID = process.env.E2E_ROOM_ID || '!TFs182DGokWnICCUm6:mindroom.lab.mindroom.chat';
const PREFIX = process.env.SHOT_PREFIX || 'before';
// NOTE: keep outside test-results/ — Playwright wipes that dir on every run.
const OUT = 'ui-audit';

const settingsJson = (themeId: string, messageLayout: number) =>
  JSON.stringify({ useSystemTheme: false, themeId, messageLayout });

test('capture styling screenshots', async ({ page }) => {
  test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Unauth routes ignore stored settings and follow prefers-color-scheme.
  await page.emulateMedia({ colorScheme: 'dark' });

  // Login page in dark theme (unauthenticated)
  await page.goto('/');
  await page.evaluate((s) => localStorage.setItem('settings', s), settingsJson('dark-theme', 0));
  await page.goto(`/login/${encodeURIComponent(HOMESERVER)}/`);
  await page.waitForSelector('[name="usernameInput"]', { timeout: 30000 });
  // Settle: fonts and the WebGL splash need a moment to paint before capture.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/${PREFIX}-login-dark.png` });

  await page.fill('[name="usernameInput"]', USERNAME as string);
  await page.fill('[name="passwordInput"]', PASSWORD as string);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home\/?$/, { timeout: 60000 });
  await page.waitForTimeout(8000); // initial sync

  const configs = [
    { name: 'dark-modern', theme: 'dark-theme', layout: 0 },
    { name: 'dark-bubble', theme: 'dark-theme', layout: 1 },
    { name: 'midnight-modern', theme: 'midnight-theme', layout: 0 },
    { name: 'light-modern', theme: 'light-theme', layout: 0 },
  ];

  for (const c of configs) {
    await page.evaluate(
      (s) => localStorage.setItem('settings', s),
      settingsJson(c.theme, c.layout)
    );
    await page.goto(`/home/${encodeURIComponent(ROOM_ID)}/`);
    const view = page.getByRole('button', { name: 'View', exact: true });
    if (await view.isVisible().catch(() => false)) {
      await view.click();
    }
    await page
      .waitForSelector('[data-room-thread-overview="true"]', { timeout: 20000 })
      .catch(() => {});
    // Settle: avatars/fonts finish painting before capture.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${PREFIX}-room-${c.name}.png` });

    if (c.name === 'dark-modern' || c.name === 'dark-bubble') {
      const threadCard = page.locator('text=CINNY-102 live test').first();
      if (await threadCard.isVisible().catch(() => false)) {
        await threadCard.click();
        await page.waitForTimeout(4000);
        await page.screenshot({ path: `${OUT}/${PREFIX}-thread-${c.name}.png` });
      }
    }
  }

  // Extra dark-theme surfaces: plain timeline, settings, create-room dialog.
  await page.evaluate(
    (s) => localStorage.setItem('settings', s),
    settingsJson('dark-theme', 0)
  );
  await page.goto('/home/');
  await page.waitForTimeout(5000);

  const fixtureRoom = page.locator('text=Cinny E2E Fixture Room').first();
  if (await fixtureRoom.isVisible().catch(() => false)) {
    await fixtureRoom.click();
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/${PREFIX}-timeline-dark.png` });
  }

  const settingsBtn = page.locator('button[aria-label^="Open settings"]').first();
  if (await settingsBtn.isVisible().catch(() => false)) {
    await settingsBtn.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${PREFIX}-settings-dark.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  const createRoom = page.locator('text=Create Room').first();
  if (await createRoom.isVisible().catch(() => false)) {
    await createRoom.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/${PREFIX}-create-room-dark.png` });
    await page.keyboard.press('Escape');
  }
});
