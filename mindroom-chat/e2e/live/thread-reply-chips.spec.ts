import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, redactEvent, sendRoomMessage } from '../helpers/matrix';

/**
 * Reply chips in thread view (MSC3440 fallback suppression).
 *
 * Real clients/bots send thread replies whose `m.in_reply_to` is only a
 * fallback (`is_falling_back: true`) pointing at the previous thread event.
 * Thread-aware rendering must ignore those — before the fix they surfaced as
 * spurious chips after every streamed (edited) message, "deleted" chips after
 * redactions, and permanently-grey placeholder chips when the target could
 * not be fetched.
 *
 * Explicit replies (is_falling_back: false) must keep their chips, and an
 * unfetchable explicit target must render as an explicit failure rather than
 * an eternal placeholder.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = Number(process.env.REPRO_REPLY_COUNT ?? 30);

type ChipSnapshot = {
  rowText: string;
  chipTarget: string | null;
  hasUsername: boolean;
  chipText: string;
};

const snapshotReplyChips = async (page: import('@playwright/test').Page): Promise<ChipSnapshot[]> =>
  page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'));
    const result: {
      rowText: string;
      chipTarget: string | null;
      hasUsername: boolean;
      chipText: string;
    }[] = [];
    rows.forEach((row) => {
      // Reply chips target another event; hover actions target this row itself.
      // Avoid development CSS class names, which production builds shorten.
      const rowEventId = row.getAttribute('data-message-id');
      const chip = Array.from(row.querySelectorAll<HTMLElement>('button[data-event-id]')).find(
        (button) => button.getAttribute('data-event-id') !== rowEventId
      );
      if (!chip) return;
      result.push({
        rowText: (row.textContent ?? '').slice(0, 200),
        chipTarget: chip.getAttribute('data-event-id'),
        hasUsername: !!chip.querySelector('b'),
        chipText: (chip.textContent ?? '').slice(0, 80),
      });
    });
    return result;
  });

test.describe('thread reply chips', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('fallback replies render no chips; explicit replies keep honest chips', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);

    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Reply chips ${Date.now()}`,
    });

    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Reply chip repro root',
    });

    const seededIds: string[] = [rootId];
    let prevId = rootId;
    for (let i = 1; i <= REPLY_COUNT; i += 1) {
      const isAgent = i % 2 === 0;
      // eslint-disable-next-line no-await-in-loop
      const id = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: `${isAgent ? 'Agent answer' : 'Human question'} ${i}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: prevId },
        },
      });
      seededIds.push(id);
      prevId = id;

      // Every 10th agent message "streams": m.replace edits land after it, so
      // the next message's fallback target is no longer the render-previous
      // event — the case that used to leak chips.
      if (isAgent && i % 10 === 0) {
        for (let e = 1; e <= 3; e += 1) {
          // eslint-disable-next-line no-await-in-loop
          await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: `* Agent answer ${i} rev${e}`,
            'm.new_content': {
              msgtype: 'm.text',
              body: `Agent answer ${i} rev${e}`,
            },
            'm.relates_to': {
              rel_type: 'm.replace',
              event_id: id,
            },
          });
        }
      }
    }

    // A redacted mid-thread message followed by a fallback reply to it.
    const redactedId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Message that will be deleted',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: prevId },
      },
    });
    await redactEvent(homeserver, session.accessToken, roomId, redactedId);
    prevId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Message after the deleted one',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: redactedId },
      },
    });

    // Fallback reply to an unfetchable target — must render no chip at all.
    prevId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Fallback reply to an unfetchable event',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: '$doesnotexist0000000000000000000000000000000' },
      },
    });

    // Explicit reply to an unfetchable target — must surface as an explicit
    // failure, not an eternal placeholder.
    prevId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Explicit reply to an unfetchable event',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: false,
        'm.in_reply_to': { event_id: '$doesnotexist1111111111111111111111111111111' },
      },
    });

    // Explicit reply to an old message near the top of the thread.
    const oldTargetId = seededIds[5];
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Explicit reply to an old message',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: false,
        'm.in_reply_to': { event_id: oldTargetId },
      },
    });

    await loginWithPassword(page, { homeserver, username, password });

    const threadUrl = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
    await page.goto(threadUrl);
    await expect(page.getByText('Explicit reply to an old message').first()).toBeVisible({
      timeout: 60_000,
    });

    // Explicit reply to a resolvable old message keeps its chip.
    await expect
      .poll(
        async () => {
          const chips = await snapshotReplyChips(page);
          return chips.find((c) => c.rowText.includes('Explicit reply to an old message'))
            ?.hasUsername;
        },
        { timeout: 30_000 }
      )
      .toBe(true);

    // Explicit reply to an unfetchable event resolves to an explicit failure
    // instead of a placeholder that never settles.
    await expect
      .poll(
        async () => {
          const chips = await snapshotReplyChips(page);
          return chips.find((c) => c.rowText.includes('Explicit reply to an unfetchable event'))
            ?.chipText;
        },
        { timeout: 60_000 }
      )
      .toContain('Failed to load message');

    // Scroll up through the whole thread so back-pagination and virtual
    // mount/unmount cycles run, then settle.
    const firstVisibleRowId = () =>
      page.evaluate(() => {
        const viewport = document
          .querySelector('[data-message-id]')
          ?.closest('[data-y-scrollbar-width]');
        if (!viewport) throw new Error('Thread scroll viewport missing');
        const bounds = viewport.getBoundingClientRect();
        return Array.from(viewport.querySelectorAll('[data-message-id]'))
          .find((row) => {
            const rect = row.getBoundingClientRect();
            return rect.bottom > bounds.top && rect.top < bounds.bottom;
          })
          ?.getAttribute('data-message-id');
      });
    const firstRowBeforeScroll = await firstVisibleRowId();
    expect(firstRowBeforeScroll).toBeTruthy();
    const viewport = page
      .locator('[data-message-id]')
      .first()
      .locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
    await viewport.hover();
    for (let s = 0; s < 12; s += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -1600);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
    }
    // Guard against a vacuous scroll phase: the viewport must actually have
    // moved into older territory.
    const firstRowAfterScroll = await firstVisibleRowId();
    expect(firstRowAfterScroll).toBeTruthy();
    expect(firstRowAfterScroll).not.toBe(firstRowBeforeScroll);
    for (let s = 0; s < 12; s += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, 1600);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(2_000);

    const chips = await snapshotReplyChips(page);
    await page.screenshot({ path: 'test-results/thread-reply-chips-final.png', fullPage: false });

    // The ONLY rows allowed to carry a reply chip are the two explicit
    // replies — every fallback reply row (after streamed edits, after the
    // deleted message, the unfetchable fallback target, window boundaries)
    // must render none. Note a chip's preview text is part of its row text,
    // so rows are identified by their own body text.
    const unexpectedChips = chips.filter((c) => !c.rowText.includes('Explicit reply'));
    expect(unexpectedChips).toEqual([]);

    // Explicit chips survive the scroll cycle. Poll: remounted chips refetch
    // their target before settling into the resolved/failed state.
    await expect
      .poll(
        async () =>
          (
            await snapshotReplyChips(page)
          ).find((c) => c.rowText.includes('Explicit reply to an old message'))?.hasUsername,
        { timeout: 30_000 }
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (
            await snapshotReplyChips(page)
          ).find((c) => c.rowText.includes('Explicit reply to an unfetchable event'))?.chipText,
        { timeout: 30_000 }
      )
      .toContain('Failed to load message');
  });
});
