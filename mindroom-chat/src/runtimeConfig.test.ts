import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildAuthenticationRecoveryAssets } from '../scripts/authentication-recovery-assets.mjs';

const assets = await buildAuthenticationRecoveryAssets();
const source = assets['runtime-config.js'];

function load(settings: Record<string, unknown> = {}, prefix = '', scriptSource = source) {
  const scripts: HTMLScriptElement[] = [];
  const window = { ...settings } as Record<string, unknown> & {
    __AUTHENTICATION_RECOVERY_READY__: Promise<void>;
  };
  runInNewContext(scriptSource, {
    window,
    URL,
    document: {
      currentScript: { src: `https://chat.example${prefix}/runtime-config.js` },
      createElement: () => ({}),
      head: { appendChild: (script: HTMLScriptElement) => scripts.push(script) },
    },
  });
  return { window, scripts };
}

describe('runtime configuration bootstrap', () => {
  it('builds a working bootstrap when invoked outside the repository root', () => {
    const builder = new URL('../scripts/authentication-recovery-assets.mjs', import.meta.url);
    const script = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { buildAuthenticationRecoveryAssets } from ${JSON.stringify(builder.href)};
         const assets = await buildAuthenticationRecoveryAssets();
         process.stdout.write(assets['runtime-config.js']);`,
      ],
      { cwd: new URL('./', import.meta.url), encoding: 'utf8' }
    );
    const { scripts } = load({}, '/chat', script);
    expect(scripts[0].src).toBe('https://chat.example/chat/authentication-recovery.js');
  });

  it('preserves deployment settings while loading recovery from the script directory', () => {
    const settings = {
      __APP_BASE_PATH__: '/chat/',
      __ENABLE_SERVICE_WORKER__: false,
      __SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__: ['/login'],
      __AUTHENTICATION_RECOVERY_CONFIG__: { probeUrl: '/probe', navigationUrl: '/login' },
    };
    const { window, scripts } = load(settings, '/chat');
    expect(window).toMatchObject(settings);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://chat.example/chat/authentication-recovery.js');
  });

  it('supplies standalone defaults', () => {
    const { window, scripts } = load();
    expect(window).toMatchObject({
      __APP_BASE_PATH__: '/',
      __ENABLE_SERVICE_WORKER__: true,
      __SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__: [],
      __AUTHENTICATION_RECOVERY_CONFIG__: null,
    });
    expect(scripts[0].src).toBe('https://chat.example/authentication-recovery.js');
  });

  it.each(['onload', 'onerror'] as const)('settles readiness after %s', async (event) => {
    const { window, scripts } = load();
    let settled = false;
    const ready = window.__AUTHENTICATION_RECOVERY_READY__.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    (scripts[0][event] as () => void)();
    await ready;
    expect(settled).toBe(true);
  });
});
