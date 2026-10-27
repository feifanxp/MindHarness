// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const APP_HTML = '<div id="root"></div><div id="portalContainer"></div>';

// portalOverlay looks the container up once, when the app first imports it.
const startApp = async (html = APP_HTML) => {
  document.body.innerHTML = html;
  vi.resetModules();
  return import('./portalOverlay');
};

const mountInPortal = (role?: string) => {
  const child = document.createElement('div');
  if (role) child.setAttribute('role', role);
  document.getElementById('portalContainer')?.append(child);
};

describe('hasBlockingPortalOverlay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is false without a portal container or with an empty one', async () => {
    expect((await startApp('<div id="root"></div>')).hasBlockingPortalOverlay()).toBe(false);
    expect((await startApp()).hasBlockingPortalOverlay()).toBe(false);
  });

  it('treats dialogs, menus, and popovers as blocking', async () => {
    const { hasBlockingPortalOverlay } = await startApp();
    mountInPortal();
    expect(hasBlockingPortalOverlay()).toBe(true);
    document.getElementById('portalContainer')?.replaceChildren();
    mountInPortal('dialog');
    expect(hasBlockingPortalOverlay()).toBe(true);
  });

  it('ignores hover tooltips, which never take input', async () => {
    const { hasBlockingPortalOverlay } = await startApp();
    mountInPortal('tooltip');
    expect(hasBlockingPortalOverlay()).toBe(false);
    mountInPortal();
    expect(hasBlockingPortalOverlay()).toBe(true);
  });

  it("keeps the app's container when a message adds an element with the same id", async () => {
    const { hasBlockingPortalOverlay, portalContainer } = await startApp();
    const appContainer = document.getElementById('portalContainer');
    // Browsers return the first match in page order; jsdom returns the first one added.
    vi.spyOn(document, 'getElementById').mockImplementation((id) =>
      document.querySelector<HTMLElement>(`#${id}`)
    );
    document
      .getElementById('root')
      ?.insertAdjacentHTML('beforeend', '<svg id="portalContainer"><g></g></svg>');

    expect(hasBlockingPortalOverlay()).toBe(false);
    expect(portalContainer).toBe(appContainer);
    appContainer?.append(document.createElement('div'));
    expect(hasBlockingPortalOverlay()).toBe(true);
  });
});
