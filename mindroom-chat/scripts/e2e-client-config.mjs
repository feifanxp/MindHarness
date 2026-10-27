import fs from 'fs';
import path from 'path';

// The hosted client config pins Local MindRoom provisioning to the production
// service. Browser tests set MINDROOM_E2E_PROVISIONING_URL (see
// playwright.config.ts) so the dev server serves that config with provisioning
// pointed at a local origin instead, and no test can reach production.
export const e2eClientConfig = (provisioningUrl) => ({
  name: 'mindroom-e2e-client-config',
  apply: 'serve',
  configureServer(server) {
    if (!provisioningUrl) return;
    server.middlewares.use((req, res, next) => {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      if (!pathname.endsWith('/config.json')) {
        next();
        return;
      }
      const config = JSON.parse(fs.readFileSync(path.resolve('config.mindroom.json'), 'utf8'));
      config.sidebar = { ...config.sidebar, mindRoomProvisioningUrl: provisioningUrl };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(config));
    });
  },
});
