import type { AuthenticationRecoveryWindow } from './authenticationRecovery';

const runtime = window as AuthenticationRecoveryWindow & {
  __APP_BASE_PATH__?: string;
  __ENABLE_SERVICE_WORKER__?: boolean;
  __SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__?: string[];
};

// Docker and custom deployments can prepend settings to this same bootstrap.
runtime.__APP_BASE_PATH__ ??= '/';
runtime.__ENABLE_SERVICE_WORKER__ ??= true;
runtime.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__ ??= [];
runtime.__AUTHENTICATION_RECOVERY_CONFIG__ ??= null;

const script = document.createElement('script');
script.src = new URL(
  'authentication-recovery.js',
  (document.currentScript as HTMLScriptElement).src
).href;
script.async = false;
runtime.__AUTHENTICATION_RECOVERY_READY__ = new Promise<void>((resolve) => {
  script.onload = () => resolve();
  script.onerror = () => resolve();
});
document.head.appendChild(script);
