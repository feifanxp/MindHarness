import type { BrowserContext, Page } from '@playwright/test';

type SyncEvent = { origin_server_ts?: number; content?: Record<string, unknown> };
type FixtureSync = { rooms?: { join?: Record<string, { timeline?: { events?: SyncEvent[] } }> } };

/** Preserve live delivery when a disposable Docker homeserver's clock leads this host. */
export const alignUiActionSync = async (
  context: BrowserContext,
  page: Page,
  homeserver: string
) => {
  const escaped = homeserver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await context.route(
    new RegExp(`^${escaped}/_matrix/client/(?:v3|r0)/sync(?:\\?|$)`),
    async (route) => {
      const response = await route.fetch({ timeout: 60_000 });
      if (response.ok()) {
        const sync = (await response.json()) as FixtureSync;
        const timestamps = Object.values(sync.rooms?.join ?? {}).flatMap((room) =>
          (room.timeline?.events ?? []).flatMap((event) =>
            event.content?.['io.mindroom.ui_action'] && Number.isFinite(event.origin_server_ts)
              ? [event.origin_server_ts!]
              : []
          )
        );
        if (timestamps.length > 0) {
          const timestamp = Math.max(...timestamps);
          const now = await page.evaluate(() => Date.now());
          if (timestamp - now > 1_000) {
            throw new Error('Disposable Matrix fixture clock is more than one second ahead.');
          }
          if (timestamp > now) {
            await page.waitForFunction((target) => Date.now() >= target, timestamp, {
              timeout: 1_000,
              polling: 10,
            });
          }
        }
      }
      await route.fulfill({ response });
    }
  );
};
