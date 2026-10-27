import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Credentials = {
  username: string;
  password: string;
};

type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
};

export const hasRequiredEnv = (name: string): boolean => !!process.env[name];

export const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required e2e environment variable: ${name}`);
  }

  return value;
};

const readDefaultHomeserverFromConfig = (): string | undefined => {
  for (const fileName of ['config.mindroom.json', 'config.json']) {
    try {
      const configPath = resolve(process.cwd(), fileName);
      const rawConfig = readFileSync(configPath, 'utf8');
      const parsedConfig = JSON.parse(rawConfig) as ClientConfig;
      const defaultIndex = parsedConfig.defaultHomeserver ?? 0;
      const homeserver = parsedConfig.homeserverList?.[defaultIndex];
      if (homeserver) return homeserver;
    } catch {
      // Fall through to the next config source.
    }
  }

  return undefined;
};

const DEFAULT_HOMESERVER = readDefaultHomeserverFromConfig() ?? 'mindroom.chat';

export const getHomeserver = (): string => process.env.E2E_HOMESERVER ?? DEFAULT_HOMESERVER;

export const hasPrimaryCredentials = (): boolean =>
  !!process.env.E2E_USERNAME && !!process.env.E2E_PASSWORD;

export const getPrimaryCredentials = (): Credentials => ({
  username: getRequiredEnv('E2E_USERNAME'),
  password: getRequiredEnv('E2E_PASSWORD'),
});

export const getSecondaryCredentials = (): Credentials | undefined => {
  const username = process.env.E2E_SECOND_USERNAME;
  const password = process.env.E2E_SECOND_PASSWORD;

  if (!username && !password) return undefined;
  if (!username || !password) {
    throw new Error(
      'E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD must both be set to run multi-account e2e tests.'
    );
  }

  return { username, password };
};

export const getThirdCredentials = (): Credentials | undefined => {
  const username = process.env.E2E_THIRD_USERNAME;
  const password = process.env.E2E_THIRD_PASSWORD;

  if (!username && !password) return undefined;
  if (!username || !password) {
    throw new Error(
      'E2E_THIRD_USERNAME and E2E_THIRD_PASSWORD must both be set to run three-account e2e tests.'
    );
  }

  return { username, password };
};

export const getDeactivationCredentials = (): Credentials | undefined => {
  const username = process.env.E2E_DEACTIVATE_USERNAME;
  const password = process.env.E2E_DEACTIVATE_PASSWORD;

  if (!username && !password) return undefined;
  if (!username || !password) {
    throw new Error(
      'E2E_DEACTIVATE_USERNAME and E2E_DEACTIVATE_PASSWORD must both be set to run deactivation e2e tests.'
    );
  }

  return { username, password };
};

const buildAuthPath = (
  authRoute: 'login' | 'register' | 'reset-password',
  homeserver: string,
  addAccount = false
): string => `/${authRoute}/${encodeURIComponent(homeserver)}${addAccount ? '?addAccount=1' : ''}`;

export const buildLoginPath = (homeserver: string, addAccount = false): string =>
  buildAuthPath('login', homeserver, addAccount);

export const buildRegisterPath = (homeserver: string, addAccount = false): string =>
  buildAuthPath('register', homeserver, addAccount);

export const buildResetPasswordPath = (homeserver: string, addAccount = false): string =>
  buildAuthPath('reset-password', homeserver, addAccount);
