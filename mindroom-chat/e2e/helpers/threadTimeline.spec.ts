import { expect, test, type Page } from '@playwright/test';
import { loadAllOlderThreadMessages } from './threadTimeline';

const readScrollPositions = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#thread-scroller');
    if (!scroller) throw new Error('Missing thread scroller');
    return {
      documentX: window.scrollX,
      documentY: window.scrollY,
      scrollerX: scroller.scrollLeft,
      scrollerY: scroller.scrollTop,
    };
  });

test.describe('loadAllOlderThreadMessages', () => {
  test('activates an offscreen control once without moving nested or document scroll positions', async ({
    page,
  }) => {
    await page.setContent(`
      <style>
        body { margin: 0; min-width: 1800px; }
        #before { height: 1400px; }
        #thread-scroller { height: 200px; overflow: auto; width: 400px; }
        #thread-content { height: 1600px; width: 1400px; padding-top: 1200px; padding-left: 900px; }
        #after { height: 1400px; }
      </style>
      <div id="before"></div>
      <div id="thread-scroller">
        <div id="thread-content">
          <button id="load-older">Load Older Messages</button>
        </div>
      </div>
      <div id="after"></div>
    `);
    await page.locator('#load-older').evaluate((button) => {
      button.addEventListener('click', () => {
        const count = Number(document.body.dataset.activationCount ?? '0');
        document.body.dataset.activationCount = String(count + 1);
        button.remove();
      });
    });
    await page.evaluate(() => {
      window.scrollTo(180, 500);
      const scroller = document.querySelector<HTMLElement>('#thread-scroller');
      if (!scroller) throw new Error('Missing thread scroller');
      scroller.scrollTo(240, 300);
    });
    const before = await readScrollPositions(page);

    const activations = await loadAllOlderThreadMessages(page);

    expect(activations).toBe(1);
    await expect(page.locator('body')).toHaveAttribute('data-activation-count', '1');
    expect(await readScrollPositions(page)).toEqual(before);
  });

  test('waits through a disabled Loading control until it is removed', async ({ page }) => {
    await page.setContent('<button id="load-older">Load Older Messages</button>');
    await page.locator('#load-older').evaluate((button) => {
      button.addEventListener('click', () => {
        const control = button as HTMLButtonElement;
        document.body.dataset.activationCount = '1';
        control.disabled = true;
        control.textContent = 'Loading...';
        window.setTimeout(() => {
          document.body.dataset.removedAt = String(performance.now());
          control.remove();
        }, 650);
      });
    });

    const activations = await loadAllOlderThreadMessages(page);
    const completion = await page.evaluate(() => ({
      activationCount: document.body.dataset.activationCount,
      removedAt: Number(document.body.dataset.removedAt),
      resolvedAt: performance.now(),
    }));

    expect(activations).toBe(1);
    expect(completion.activationCount).toBe('1');
    expect(completion.removedAt).toBeGreaterThan(0);
    expect(completion.resolvedAt).toBeGreaterThanOrEqual(completion.removedAt);
    await expect(page.getByRole('button')).toHaveCount(0);
  });

  test('rejects multiple matching history controls without activating either', async ({ page }) => {
    await page.setContent(`
      <button>Load Older Messages</button>
      <button>Load Older Messages</button>
    `);
    await page.getByRole('button').evaluateAll((buttons) => {
      for (const button of buttons) {
        button.addEventListener('click', () => {
          const count = Number(document.body.dataset.activationCount ?? '0');
          document.body.dataset.activationCount = String(count + 1);
          button.remove();
        });
      }
    });

    await expect(loadAllOlderThreadMessages(page)).rejects.toThrow(
      'Multiple "Load Older Messages" buttons matched'
    );
    expect(await page.locator('body').getAttribute('data-activation-count')).toBeNull();
  });

  test('returns zero after two absent observations when no history control exists', async ({
    page,
  }) => {
    await page.setContent('<main>No history control</main>');
    const startedAt = performance.now();

    const activations = await loadAllOlderThreadMessages(page);

    expect(activations).toBe(0);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(450);
  });
});
