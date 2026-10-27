import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';
import { readFileSync } from 'node:fs';
const readLocale = (code: string) =>
  JSON.parse(
    readFileSync(new URL('../../src/app/locales/' + code + '.json', import.meta.url), 'utf8')
  );
const ar = readLocale('ar');
const ja = readLocale('ja');
const zhTW = readLocale('zh-TW');
const zh = readLocale('zh');

test.describe('complete interface localization', () => {
  test.skip(!process.env.E2E_USERNAME, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('switches an open settings dialog without reloading and remembers the choice', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
      simpleMode: true,
    });
    await loginWithPassword(page, { homeserver, username, password });
    await page.getByRole('button', { name: /Open settings for / }).click();
    await page.getByRole('button', { name: 'General', exact: true }).click();
    await page.evaluate(() => {
      (window as Window & { localizationMarker?: string }).localizationMarker = 'same-document';
    });
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Español', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByText('Idioma de la aplicación', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Español', exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as Window & { localizationMarker?: string }).localizationMarker
      )
    ).toBe('same-document');

    let selected = 'Español';
    for (const [code, nativeName, direction, label] of [
      ['ar', 'العربية', 'rtl', ar.settings.general.language.appLanguage],
      ['ja', '日本語', 'ltr', ja.settings.general.language.appLanguage],
      ['zh', '简体中文', 'ltr', zh.settings.general.language.appLanguage],
      ['zh-TW', '繁體中文', 'ltr', zhTW.settings.general.language.appLanguage],
      ['es', 'Español', 'ltr', 'Idioma de la aplicación'],
    ]) {
      await page.setViewportSize(
        code === 'ar' ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      await page.getByRole('button', { name: selected, exact: true }).click();
      await expect(page.getByRole('button', { name: 'বাংলা', exact: true })).toBeAttached();
      await page.getByRole('button', { name: nativeName, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page.locator('html')).toHaveAttribute('dir', direction);
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      const switches = await page.getByRole('switch').evaluateAll((elements) =>
        elements.map((element) => {
          const track = element.getBoundingClientRect();
          const thumb = element.firstElementChild!.getBoundingClientRect();
          return {
            checked: element.getAttribute('aria-checked') === 'true',
            inside: thumb.left >= track.left && thumb.right <= track.right,
            leftHalf: thumb.left + thumb.width / 2 < track.left + track.width / 2,
          };
        })
      );
      expect(switches.length).toBeGreaterThan(0);
      for (const toggle of switches) {
        expect(toggle.inside).toBe(true);
        expect(toggle.leftHalf).toBe(direction === 'rtl' ? toggle.checked : !toggle.checked);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as Window & { localizationMarker?: string }).localizationMarker
        )
      ).toBe('same-document');
      await page.screenshot({ path: 'ui-audit/i18n-settings-' + code + '.png' });
      selected = nativeName;
    }
    expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toBe('es');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(
      page.getByRole('button', { name: /Abrir (los )?ajustes de / }).first()
    ).toBeVisible();
  });
});

test('preserves authored summaries across room overview and thread banner in Arabic and Japanese', async ({
  page,
}) => {
  test.skip(!process.env.E2E_USERNAME, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.slow();
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: 'Localization summary ' + Date.now(),
  });
  const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Image',
  });
  await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Code: npm test',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>Code: <code>npm test</code></p>',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  const summary = 'User summary <3 & code: npm test';
  await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.notice',
    body: summary,
    'io.mindroom.thread_summary': {
      version: 1,
      summary,
      generated_at: new Date().toISOString(),
      message_count: 2,
    },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  await loginWithPassword(page, { homeserver, username, password });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: session.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  for (const [code, direction] of [
    ['ar', 'rtl'],
    ['ja', 'ltr'],
  ]) {
    await page.evaluate((language) => localStorage.setItem('i18nextLng', language), code);
    await page.goto('/home/' + encodeURIComponent(roomId));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('html')).toHaveAttribute('dir', direction);
    const card = page.locator('[data-thread-root-id="' + rootId + '"]');
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toContainText(summary);
    await page.screenshot({ path: 'ui-audit/i18n-overview-' + code + '.png' });
    await card.click();
    const banner = page.locator('[data-thread-context-summary="true"]').first();
    await expect(banner).toContainText(summary, { timeout: 30000 });
    const composer = page.locator('[data-editable-name="RoomInput"]');
    await expect(composer).toHaveAttribute('dir', 'auto');
    await expect(page.locator('pre, code').first()).toHaveCSS('direction', 'ltr');
    await page.screenshot({ path: 'ui-audit/i18n-thread-' + code + '.png' });
  }
});
