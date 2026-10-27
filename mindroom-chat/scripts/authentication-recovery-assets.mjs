import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Build classic scripts independently of the app's module graph and cached shell. */
export async function buildAuthenticationRecoveryAssets() {
  const options = {
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
  };
  const [recovery, runtime] = await Promise.all([
    build({
      ...options,
      stdin: {
        contents:
          "import { installAuthenticationRecovery } from './src/authenticationRecovery'; installAuthenticationRecovery(window);",
        resolveDir: root,
      },
    }),
    build({ ...options, entryPoints: ['src/runtimeConfig.ts'] }),
  ]);
  return {
    'authentication-recovery.js': recovery.outputFiles[0].text,
    'runtime-config.js': runtime.outputFiles[0].text,
  };
}

export function authenticationRecoveryAssets() {
  return {
    name: 'mindroom-authentication-recovery-assets',
    async generateBundle() {
      for (const [fileName, source] of Object.entries(await buildAuthenticationRecoveryAssets())) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        const fileName = pathname?.match(
          /^\/(?:[^/]+\/)?(runtime-config\.js|authentication-recovery\.js)$/
        )?.[1];
        if (!fileName) return next();
        try {
          const assets = await buildAuthenticationRecoveryAssets();
          response.setHeader('Content-Type', 'application/javascript');
          response.setHeader('Cache-Control', 'no-store');
          response.end(assets[fileName]);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
