import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { e2eClientConfig } from '../scripts/e2e-client-config.mjs';
import playwrightConfig from '../playwright.config';

type Middleware = (
  req: { url?: string },
  res: { setHeader: (name: string, value: string) => void; end: (body: string) => void },
  next: () => void
) => void;

const installMiddleware = (provisioningUrl: string | undefined) => {
  const middlewares: Middleware[] = [];
  const plugin = e2eClientConfig(provisioningUrl);
  plugin.configureServer({ middlewares: { use: (fn: Middleware) => middlewares.push(fn) } });
  return middlewares;
};

const request = (middleware: Middleware, url: string) => {
  const res = { setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  middleware({ url }, res, next);
  return { res, next };
};

describe('e2e client config', () => {
  it('points provisioning at the local dev server so browser tests never reach the hosted service', () => {
    const [middleware] = installMiddleware('http://127.0.0.1:4173');
    const hosted = JSON.parse(readFileSync('config.mindroom.json', 'utf8'));

    const { res, next } = request(middleware, '/config.json?cache=1');

    expect(next).not.toHaveBeenCalled();
    const served = JSON.parse(res.end.mock.calls[0][0]);
    expect(served.sidebar.mindRoomProvisioningUrl).toBe('http://127.0.0.1:4173');
    expect({
      ...served,
      sidebar: { ...served.sidebar, mindRoomProvisioningUrl: undefined },
    }).toEqual({
      ...hosted,
      sidebar: { ...hosted.sidebar, mindRoomProvisioningUrl: undefined },
    });
  });

  it('leaves other requests and non-e2e servers alone', () => {
    const [middleware] = installMiddleware('http://127.0.0.1:4173');
    expect(request(middleware, '/home/').next).toHaveBeenCalledTimes(1);
    expect(installMiddleware(undefined)).toHaveLength(0);
  });

  it('is enabled for the Playwright dev server', () => {
    const webServer = playwrightConfig.webServer;
    expect(Array.isArray(webServer)).toBe(false);
    expect(
      webServer && !Array.isArray(webServer)
        ? webServer.env?.MINDROOM_E2E_PROVISIONING_URL
        : undefined
    ).toBe(new URL(String(playwrightConfig.use?.baseURL)).origin);
  });
});
