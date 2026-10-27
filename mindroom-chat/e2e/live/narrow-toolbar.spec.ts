import { expect, test } from '@playwright/test';

const HOMESERVER = process.env.E2E_HOMESERVER || 'https://mindroom.lab.mindroom.chat';
const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const ROOM_ID = process.env.E2E_ROOM_ID || '!TFs182DGokWnICCUm6:mindroom.lab.mindroom.chat';
const PREFIX = process.env.SHOT_PREFIX || 'before';
const TOOLBAR = '[data-room-thread-overview="true"] [role="toolbar"]';

test('narrow toolbar keeps groups in horizontal rows', async ({ page }) => {
  test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'settings',
      JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', messageLayout: 0 })
    )
  );
  await page.goto(`/login/${encodeURIComponent(HOMESERVER)}/`);
  await page.fill('[name="usernameInput"]', USERNAME as string);
  await page.fill('[name="passwordInput"]', PASSWORD as string);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home\/?$/, { timeout: 60000 });
  await page.goto(`/home/${encodeURIComponent(ROOM_ID)}/`);
  await page.waitForSelector(TOOLBAR, { timeout: 30000 });

  for (const width of [900, 700, 560]) {
    await page.setViewportSize({ width, height: 900 });
    // Brief settle so the flex re-layout finishes painting before measuring.
    await page.waitForTimeout(500);

    // Regression guard: every toolbar group must lay out as ONE horizontal
    // row. Before the fix, squeezed groups wrapped internally into
    // 1-button-wide vertical columns.
    const groups = page.locator(`${TOOLBAR} [role="group"]`);
    const groupCount = await groups.count();
    expect(groupCount).toBeGreaterThan(0);
    for (let i = 0; i < groupCount; i += 1) {
      const tops = await groups
        .nth(i)
        .locator('button')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(tops.length).toBeGreaterThan(0);
      expect(
        new Set(tops).size,
        `toolbar group ${i} should render as a single row at ${width}px`
      ).toBe(1);
    }

    await page.screenshot({ path: `ui-audit/${PREFIX}-toolbar-${width}.png` });
  }
});
