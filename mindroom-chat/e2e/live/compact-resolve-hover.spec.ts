import { expect, test, type Locator } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

const expectActionOpacity = async (action: Locator, opacity: number) => {
  await expect
    .poll(() =>
      action.evaluate((element) => {
        let effectiveOpacity = 1;
        for (let current: Element | null = element; current; current = current.parentElement) {
          effectiveOpacity *= Number(getComputedStyle(current).opacity);
        }
        return effectiveOpacity;
      })
    )
    .toBe(opacity);
};

const buildThreadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

for (const touch of [false, true]) {
  test.describe(`compact actions ${touch ? 'touch' : 'desktop'}`, () => {
    // The pending-save probe must intercept writes before a service worker handles them.
    test.use({ hasTouch: touch, serviceWorkers: 'block' });
    test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

    test('overlays on hover without moving text and resolves without opening', async ({
      page,
      hasTouch,
    }, testInfo) => {
      const diagnostics = attachBrowserDiagnostics(page);
      const homeserver = getHomeserver();
      const { username, password } = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, username, password);
      const stamp = Date.now();
      const roomName = `Compact resolve hover ${stamp}`;
      const rootBody = `Resolve this compact thread ${stamp}`;
      const idleRootBody = `Leave this compact thread idle ${stamp}`;
      const roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name: roomName,
        topic: 'Live fixture for the Compact room Resolve action.',
      });
      const rootId = await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        { msgtype: 'm.text', body: rootBody },
        'compact-resolve-hover-root'
      );
      await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        {
          msgtype: 'm.text',
          body: `Compact resolve reply ${stamp}`,
          'm.relates_to': buildThreadRelation(rootId),
        },
        'compact-resolve-hover-reply'
      );
      const idleRootId = await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        { msgtype: 'm.text', body: idleRootBody },
        'compact-resolve-idle-root'
      );
      await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        {
          msgtype: 'm.text',
          body: `Idle compact reply ${stamp}`,
          'm.relates_to': buildThreadRelation(idleRootId),
        },
        'compact-resolve-idle-reply'
      );

      // Keep relative-time labels stable while comparing exact hover geometry.
      await page.clock.setFixedTime(new Date());

      await loginWithPassword(page, { homeserver, username, password });
      await expectLoggedInShellStable(page);
      if (hasTouch) {
        await page.evaluate(() => {
          localStorage.setItem('i18nextLng', 'nl');
          const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
          localStorage.setItem(
            'settings',
            JSON.stringify({ ...settings, useSystemTheme: false, themeId: 'butter-theme' })
          );
        });
        await page.reload();
      }
      await seedRoomOverviewState({
        page,
        roomId,
        userId: session.userId,
        viewMode: 'compact',
        filterState: createDefaultThreadFilterState(),
      });

      const roomLink = page.getByRole('link', { name: roomName }).first();
      await expect(roomLink).toBeVisible({ timeout: 30_000 });
      await roomLink.click();

      const threadCard = page.locator(`[data-thread-root-id="${rootId}"]`);
      const cardShell = threadCard.locator('xpath=..');
      const resolveButton = cardShell.locator('[data-compact-thread-resolve="true"]');
      const idleThreadCard = page.locator(`[data-thread-root-id="${idleRootId}"]`);
      const idleCardShell = idleThreadCard.locator('xpath=..');
      const idleResolveButton = idleCardShell.locator('[data-compact-thread-resolve="true"]');
      const activateAction = (action: Locator) => (hasTouch ? action.tap() : action.click());
      const staticActions = await page.evaluate(
        () => matchMedia('(max-width: 480px), (hover: none)').matches
      );
      await expect(threadCard).toBeVisible({ timeout: 30_000 });
      await expect(idleThreadCard).toBeVisible({ timeout: 30_000 });
      if (!staticActions) await expect(resolveButton).toHaveAccessibleName('Resolve');
      if (staticActions) await expect(resolveButton).toBeHidden();
      else await expectActionOpacity(resolveButton, 0);
      if (staticActions) await expect(idleResolveButton).toBeHidden();
      else await expectActionOpacity(idleResolveButton, 0);

      const titleBeforeHover = await threadCard.getByText(rootBody, { exact: true }).boundingBox();
      expect(titleBeforeHover, 'title bounding box before hover').not.toBeNull();
      const restingPadding = await threadCard.evaluate((card) => {
        const style = getComputedStyle(card);
        const metadata = card.querySelector<HTMLElement>('[data-compact-card-metadata="true"]')!;
        return {
          inlineStart: Number.parseFloat(style.paddingInlineStart),
          inlineEnd: Number.parseFloat(style.paddingInlineEnd),
          metadataInlineEnd: Number.parseFloat(getComputedStyle(metadata).paddingInlineEnd),
        };
      });
      // Title and preview use the full card width; on touch only the last row
      // makes room for the menu button.
      expect(restingPadding.inlineEnd).toBe(restingPadding.inlineStart);
      if (staticActions) expect(restingPadding.metadataInlineEnd).toBeGreaterThan(0);
      else expect(restingPadding.metadataInlineEnd).toBe(0);

      if (!staticActions) {
        await cardShell.hover();
        await expectActionOpacity(resolveButton, 1);
        await expectActionOpacity(idleResolveButton, 0);
        const titleAfterHover = await threadCard.getByText(rootBody, { exact: true }).boundingBox();
        expect(titleAfterHover, 'title bounding box after hover').not.toBeNull();
        expect(titleAfterHover!).toEqual(titleBeforeHover!);
        const actionFade = await resolveButton.evaluate((action) => {
          const style = getComputedStyle(action.parentElement!, '::before');
          return {
            display: style.display,
            backgroundImage: style.backgroundImage,
            width: Number.parseFloat(style.width),
            insetInlineStart: Number.parseFloat(style.insetInlineStart),
          };
        });
        expect(actionFade.backgroundImage).not.toBe('none');
        expect(actionFade.width).toBeGreaterThan(0);
        expect(actionFade.insetInlineStart).toBe(-actionFade.width);
        expect(actionFade.display).toBe('block');
        await page.screenshot({ path: testInfo.outputPath('compact-actions-desktop.png') });
        const screenshotVariant = process.env.E2E_SCREENSHOT_VARIANT;
        if (screenshotVariant) {
          await page.screenshot({
            path: `ui-audit/compact-resolve-overlay-${screenshotVariant}.png`,
          });
        }

        await page.mouse.move(0, 0);
        await expectActionOpacity(resolveButton, 0);
        await threadCard.focus();
        await page.keyboard.press('Tab');
        await expect(resolveButton).toBeFocused();
        await expectActionOpacity(resolveButton, 1);

        // Disabled styles must not reveal an idle desktop hover action.
        await idleResolveButton.evaluate(async (button: HTMLButtonElement) => {
          button.disabled = true;
          await Promise.all(button.getAnimations().map((animation) => animation.finished));
        });
        await expectActionOpacity(idleResolveButton, 0);
        await idleResolveButton.evaluate((button: HTMLButtonElement) => {
          button.disabled = false;
        });
      }

      await page.setViewportSize({ width: 420, height: 800 });
      // ScreenSizeContext follows ResizeObserver; touch controls are already visible
      // before the room navigation has switched to the narrow layout.
      await expect(roomLink).toBeHidden();
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
      });
      const moreButton = cardShell.getByRole('button', {
        name: hasTouch ? 'Threadopties' : 'Thread options',
        exact: true,
      });
      const idleMoreButton = idleCardShell.getByRole('button', {
        name: hasTouch ? 'Threadopties' : 'Thread options',
        exact: true,
      });
      await expect(resolveButton).toBeHidden();
      await expect(cardShell.locator('[data-compact-thread-pin]')).toBeHidden();
      await expect(moreButton).toBeVisible();
      const layout = await cardShell.evaluate((shell) => {
        const card = shell.querySelector<HTMLElement>('[data-thread-root-id]')!;
        const metadata = card.querySelector<HTMLElement>('[data-compact-card-metadata="true"]')!;
        const action = shell.querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
        const cardRect = card.getBoundingClientRect();
        const metadataRect = metadata.getBoundingClientRect();
        const actionRect = action.getBoundingClientRect();
        return {
          shellHeight: shell.getBoundingClientRect().height,
          cardHeight: cardRect.height,
          cardLeft: cardRect.left,
          cardTop: cardRect.top,
          cardBottom: cardRect.bottom,
          metadataLeft: metadataRect.left,
          metadataCenter: (metadataRect.top + metadataRect.bottom) / 2,
          metadataInlineEnd: Number.parseFloat(getComputedStyle(metadata).paddingInlineEnd),
          actionLeft: actionRect.left,
          actionRight: actionRect.right,
          actionTop: actionRect.top,
          actionBottom: actionRect.bottom,
          actionCenter: (actionRect.top + actionRect.bottom) / 2,
          actionWidth: actionRect.width,
          actionHeight: actionRect.height,
        };
      });
      expect(layout.shellHeight).toBe(layout.cardHeight);
      // RTL: the button sits at the start of the last row, centered on it and
      // beside the row's content; the title and preview rows reserve nothing.
      expect(layout.actionLeft).toBeGreaterThanOrEqual(layout.cardLeft);
      expect(layout.actionRight).toBeLessThanOrEqual(
        layout.metadataLeft + layout.metadataInlineEnd
      );
      expect(Math.abs(layout.actionCenter - layout.metadataCenter)).toBeLessThanOrEqual(1);
      expect(layout.actionTop).toBeGreaterThanOrEqual(layout.cardTop);
      expect(layout.actionBottom).toBeLessThanOrEqual(layout.cardBottom);
      expect(layout.actionWidth).toBeGreaterThanOrEqual(32);
      expect(layout.actionHeight).toBeGreaterThanOrEqual(32);
      await threadCard.focus();
      await page.keyboard.press('Tab');
      await expect(moreButton).toBeFocused();
      await moreButton.blur();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath('compact-actions-mobile-rtl.png') });
      await page.evaluate(() => {
        document.documentElement.dir = 'ltr';
      });
      await page.screenshot({ path: testInfo.outputPath('compact-actions-mobile.png') });
      if (hasTouch) {
        const pinnedCard = page.locator(
          `[data-pinned-threads="true"] [data-thread-root-id="${rootId}"]`
        );
        await activateAction(moreButton);
        await activateAction(page.locator('[data-thread-action="pin"]'));
        await expect(pinnedCard).toBeVisible();
        await expect(page.locator('[data-thread-action="pin"]')).toBeEnabled();
        await page.keyboard.press('Escape');
        await activateAction(moreButton);
        await activateAction(page.locator('[data-thread-action="pin"]'));
        await expect(pinnedCard).toHaveCount(0);
        await expect(page.locator('[data-thread-action="pin"]')).toBeEnabled();
        await page.keyboard.press('Escape');
      }
      const resolveFromMenu = async (trigger: Locator) => {
        await activateAction(trigger);
        await activateAction(
          page.getByRole('menuitem', { name: hasTouch ? 'Oplossen' : 'Resolve', exact: true })
        );
        await expect(page.locator('[data-thread-action="resolve"]')).toHaveText(
          hasTouch ? 'Thread heropenen' : 'Reopen thread'
        );
        await expect(page.locator('[data-thread-action="resolve"]')).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden();
      };

      // Desktop quick actions allow another thread to resolve while a save is pending.
      // Touch menus hold focus until their save completes.
      if (!hasTouch) await page.setViewportSize({ width: 1280, height: 800 });
      let releaseSave!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const tagWrites: string[] = [];
      await page.route('**/state/com.mindroom.thread.tags/**', async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        const stateKey = decodeURIComponent(
          new URL(route.request().url()).pathname.split('/').pop()!
        );
        tagWrites.push(stateKey);
        if (!hasTouch && stateKey === JSON.stringify([rootId, 'resolved'])) await saveGate;
        await route.continue();
      });
      if (hasTouch) await resolveFromMenu(moreButton);
      else {
        await cardShell.hover();
        await activateAction(resolveButton);
      }
      await expect.poll(() => tagWrites.length).toBe(1);
      if (hasTouch) {
        await expect(idleMoreButton).toBeEnabled();
        await resolveFromMenu(idleMoreButton);
      } else {
        await expect(idleResolveButton).toBeEnabled();
        await idleCardShell.hover();
        await expectActionOpacity(idleResolveButton, 1);
        await activateAction(idleResolveButton);
      }
      await expect
        .poll(() => tagWrites)
        .toEqual([JSON.stringify([rootId, 'resolved']), JSON.stringify([idleRootId, 'resolved'])]);
      releaseSave();
      await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBeNull();
      const resolvedStatePath = `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
        'com.mindroom.thread.tags'
      )}/${encodeURIComponent(JSON.stringify([rootId, 'resolved']))}`;
      await expect
        .poll(
          async () => {
            try {
              const content = await matrixFetch<{ set_by?: string }>(
                homeserver,
                resolvedStatePath,
                {
                  accessToken: session.accessToken,
                }
              );
              return content.set_by;
            } catch {
              return undefined;
            }
          },
          { timeout: 30_000 }
        )
        .toBe(session.userId);
      await expect(resolveButton).toHaveCount(0);
      await expect(threadCard).toHaveAccessibleName(hasTouch ? /Opgelost door / : /Resolved by /);

      await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'compact-resolve-hover');
    });
  });
}
