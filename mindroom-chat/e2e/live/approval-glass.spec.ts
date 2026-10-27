import { expect, Locator, test } from '@playwright/test';
import {
  buildLoginPath,
  getHomeserver,
  getPrimaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import { expectFloatingNavHeader } from '../helpers/glassVisual';
import { expectInsetScrollbar } from '../helpers/insetScrollbar';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';

const headerGeometry = (header: Locator) =>
  header.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const trailing = element.lastElementChild;
    const trailingRect = trailing?.getBoundingClientRect();
    return {
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      height: rect.height,
      radius: style.borderTopLeftRadius,
      trailingIcon: trailing?.tagName.toLowerCase() === 'svg',
      trailingGap: trailingRect ? rect.right - trailingRect.right : null,
    };
  });

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`approval sheets and tool expanders use consistent surfaces at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(homeserver).hostname),
      'This fixture creates rooms only on a local Matrix server'
    );
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The local Matrix fixture has no provisioning service.
    await page.route('**/v1/local-mindroom/connections', (route) =>
      route.fulfill({ json: { connections: [] } })
    );
    await page.addInitScript(() => {
      localStorage.setItem(
        'settings',
        JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', isPeopleDrawer: false })
      );
    });
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const router = await registerAgentAccount(homeserver, 'router');
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: 'Design notes',
      topic: 'Local approval and tool control fixture',
      invite: [router.userId],
    });
    await joinRoom(homeserver, router.accessToken, roomId);
    try {
      const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'Save the design notes and prepare the next meeting.\n\nThe agenda covers layout and keyboard shortcuts. Check focus order, review the release checklist, and keep each decision easy to find.',
      });
      const relation = {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      };
      const responseId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'The first note is saved.\n🔧 save_note [1]',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>The first note is saved.</p><p>🔧 <code>save_note</code> [1]</p>',
        'io.mindroom.tool_trace': {
          version: 2,
          events: [
            {
              type: 'tool_call_completed',
              tool_name: 'save_note',
              result_preview: 'Saved the design notes.',
            },
          ],
        },
        'm.relates_to': relation,
      });
      const sendApproval = (status: 'approved' | 'pending', index = 0) =>
        matrixFetch(
          homeserver,
          `/rooms/${encodeURIComponent(roomId)}/send/io.mindroom.tool_approval/${status}-${index}`,
          {
            method: 'PUT',
            accessToken: router.accessToken,
            body: JSON.stringify({
              msgtype: 'io.mindroom.tool_approval',
              body: 'Approval required: save_note',
              approval_id: `${status}-${index}`,
              tool_name: 'save_note',
              agent_name: 'assistant',
              status,
              approvable: true,
              approver_user_id: session.userId,
              requester_id: session.userId,
              approval_scope: {
                id: 'save-note',
                entity_name: 'assistant',
                invoking_agent: 'assistant',
                operation: { tool_name: 'save_note' },
              },
              arguments: { title: 'Meeting notes', text: 'Ready for the next design review.' },
              requested_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 600_000).toISOString(),
              ...(status === 'approved'
                ? {
                    resolved_at: new Date().toISOString(),
                    resolved_by: session.userId,
                    response_event_id: responseId,
                  }
                : {}),
              thread_id: rootId,
              'm.relates_to': relation,
            }),
          }
        );
      await sendApproval('approved');
      await Promise.all(Array.from({ length: 4 }, (_, index) => sendApproval('pending', index)));
      await page.goto(buildLoginPath(homeserver));
      await page.locator('input[name="usernameInput"]').fill(credentials.username);
      await page.locator('input[name="passwordInput"]').fill(credentials.password);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      // Wait for this room's initial sync before leaving the login router.
      const roomPath = `/home/${encodeURIComponent(roomId)}`;
      const roomLink = page.locator(`a[href="${roomPath}"]`);
      await expect(roomLink).toBeVisible({ timeout: 60_000 });
      await roomLink.click();
      await page.waitForURL((url) => url.pathname === roomPath);
      await page.evaluate((url) => {
        window.history.pushState(null, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `${roomPath}?threadId=${encodeURIComponent(rootId)}`);

      const tool = page.getByRole('button', { name: /^Ran 1 tool call/ });
      const approval = page.getByRole('button', { name: /^You approved save_note/ });
      await expect(tool).toBeVisible();
      await expect(approval).toBeVisible();
      await tool.scrollIntoViewIfNeeded();
      const toolGeometry = await headerGeometry(tool);
      const approvalGeometry = await headerGeometry(approval);
      expect
        .soft(approvalGeometry.padding, 'both header families share spacing')
        .toEqual(toolGeometry.padding);
      expect
        .soft(approvalGeometry.radius, 'both expander shells share corner radius')
        .toBe(toolGeometry.radius);
      expect
        .soft(approvalGeometry.height, 'both collapsed headers share height')
        .toBeCloseTo(toolGeometry.height, 0);
      expect.soft(toolGeometry.trailingIcon, 'tool chevron trails its label').toBe(true);
      expect.soft(approvalGeometry.trailingIcon, 'approval chevron trails its label').toBe(true);
      expect
        .soft(approvalGeometry.trailingGap, 'trailing icons share the same inset')
        .toBeCloseTo(toolGeometry.trailingGap!, 0);
      await page.screenshot({ path: testInfo.outputPath('collapsed-expanders.png') });

      await tool.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('Saved the design notes.', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('expanded-tool-details.png') });
      await page.keyboard.press('Space');
      await expect(page.getByText('Saved the design notes.', { exact: true })).toBeHidden();
      await expect(tool).toBeFocused();

      const history = approval.locator('..');
      await approval.focus();
      await page.keyboard.press('Enter');
      await expect(approval).toHaveAttribute('aria-expanded', 'true');
      const receipt = history.locator('details[aria-label="Resolved tool approval request"]');
      await expect(receipt).toBeVisible();
      await receipt.locator('summary').first().click();
      await expect(receipt).toHaveAttribute('open', '');
      await page.mouse.move(0, viewport.height - 1);
      await page.screenshot({ path: testInfo.outputPath('expanded-approval-receipt.png') });
      await approval.focus();
      await page.keyboard.press('Space');
      await expect(approval).toHaveAttribute('aria-expanded', 'false');
      await expect(approval).toBeFocused();

      const review = page
        .getByRole('region', { name: 'Thread approvals' })
        .getByRole('button', { name: /^Review/ });
      await review.click();
      const dialog = page.getByRole('dialog', {
        name: 'assistant wants to do 4 things',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const tintAlpha = await dialog.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d')!;
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3] / 255;
      });
      expect
        .soft(tintAlpha, 'dark approval review uses the shared 90% dense tint')
        .toBeCloseTo(0.9, 2);
      await page.screenshot({ path: testInfo.outputPath('approval-dialog.png') });
      await dialog.getByRole('button', { name: 'Show 4 calls', exact: true }).click();
      await page.setViewportSize({ ...viewport, height: 480 });
      const title = dialog.locator('header');
      const dialogScroll = await expectFloatingNavHeader(title, { inheritsPanelTint: true });
      await dialogScroll.evaluate((element) => {
        element.scrollTop = 160;
      });
      await expectFloatingNavHeader(title, { inheritsPanelTint: true });
      await expectInsetScrollbar(page, dialogScroll, title);
      await page.screenshot({ path: testInfo.outputPath('approval-dialog-scrolled.png') });

      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(review).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      expect(errors).toEqual([]);
    } finally {
      await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
        method: 'POST',
        accessToken: session.accessToken,
        body: '{}',
      });
      await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
        method: 'POST',
        accessToken: session.accessToken,
        body: '{}',
      });
    }
  });
}
