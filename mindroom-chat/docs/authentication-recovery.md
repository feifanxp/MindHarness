# Reverse-proxy authentication recovery

The client can recover an expired reverse-proxy login while preserving the Matrix session, encryption keys, local storage, IndexedDB, and cached assets.
This is opt-in and does not implement authentication policy.

Set these image environment variables:

```sh
APP_AUTHENTICATION_RECOVERY_PROBE_URL=/authentication-recovery-probe
```

Alternatively, a deployment that supplies `runtime-config.js` can set:

```js
window.__AUTHENTICATION_RECOVERY_CONFIG__ = {
  probeUrl: '/authentication-recovery-probe',
  navigationUrl: '',
  timeoutMs: 5000,
};
```

An absent or empty `navigationUrl` returns to the current pathname, query, and fragment after sign-in, including for applications under a path prefix.
Set `APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL` or a nonempty runtime `navigationUrl` only when recovery must use a fixed destination.
The probe and any nonempty navigation URL must resolve to the application's origin, use HTTP or HTTPS, and contain no credentials.
Use root-relative paths or same-origin absolute URLs for configured destinations; page-relative paths and protocol-relative URLs are rejected so the retry identity stays stable across navigations.
Raw control characters, path backslashes, encoded path separators, and encoded dot segments also disable recovery before a probe or worker action.
The optional timeout defaults to 5 seconds and is bounded to 1–30 seconds.
A missing or invalid object disables automatic recovery.

The image serves `/authentication-recovery-probe` with HTTP 204 and `Cache-Control: no-store`.
Protect this exact endpoint with the same reverse-proxy session policy as the application.
An expired session must return HTTP 401 or redirect to interactive sign-in.
The client uses a credentialed, uncached request with manual redirect handling.
Only HTTP 204 confirms a healthy session; HTTP 403 means access denied and does not trigger automatic recovery.
HTTP 200, other statuses, network errors, offline state, and timeouts do not trigger automatic recovery.
Do not return a public 204 before the authentication check, and do not exempt chat, configuration, Matrix, or API routes from authentication.
The navigation destination must initiate the normal protected sign-in flow and return the user to the application.
Recovery adds or replaces the `authentication-recovery-navigation=1` query marker without dropping other query values or the current fragment.
An explicit destination retains its own pathname and query; the current fragment is retained unless that destination supplies one.

## Bootstrap and cached clients

`runtime-config.js` loads the image's `/authentication-recovery.js` as a classic script.
Current HTML also loads this idempotent asset directly, so existing custom runtime scripts retain the explicit sign-in action.
Both assets are served with `Cache-Control: no-store` and excluded from the current service worker's precache.
The image also supports its existing single-segment deployment prefix, such as `/chat/authentication-recovery.js` and `/chat/authentication-recovery-probe`.
The bootstrap does not need the Matrix app bundle or configuration fetch to succeed.
If the reverse proxy protects all assets, allow only the exact runtime configuration and bootstrap asset routes needed to run recovery; retain authentication on the probe and navigation destination.

The source files are `src/authenticationRecovery.ts` and `src/runtimeConfig.ts`.
Vite builds both as standalone classic scripts and serves the same generated assets in development.
They remain outside the application bundle and service-worker precache.
The Docker image preserves the built runtime script at `/opt/mindroom/runtime-config.js` and appends it after the entrypoint's deployment settings.

Deployments generating their own `runtime-config.js` should prepend their settings to the built runtime script instead of copying loader code:

```sh
cat deployment-settings.js dist/runtime-config.js > runtime-config.js
```

The settings file assigns the deployment globals, including `window.__AUTHENTICATION_RECOVERY_CONFIG__` as shown above.
The built script fills absent settings with defaults and loads recovery relative to its own served URL.
Serve the combined file as the deployment's `runtime-config.js` alongside the built `authentication-recovery.js`.

The bootstrap is idempotent and exposes `window.__AUTHENTICATION_RECOVERY__.check()` and `.navigate()`.
The existing configuration-error sign-in action delegates to this owner and shares its probe, but not its retry budget.
For configured deployments, `navigate()` sends its own probe, so a pending automatic check cannot answer the click.
Any response other than an exact HTTP 204 navigates, even when worker removal fails, because a click cannot loop.
A failed or timed out probe, or the browser going offline before the navigation, returns `unavailable` and keeps the offline screen.
If the probe instead confirms a healthy session, the configuration-error sign-in action retries fresh configuration and keeps cached configuration gated until the request succeeds or the user continues offline.
Without configuration, the explicit sign-in action navigates on every click and still records the attempt for the page origin.
A successfully fetched and validated fresh client configuration notifies the owner through `configurationLoaded()` to reset only that unconfigured record; cached configuration and failed loads never reset it.

A cached predecessor HTML page can receive this fix if it already fetches mutable `runtime-config.js` from the network.
A page that precaches that script, contains all its bootstrap code inline, or never references a mutable asset cannot consume new code merely because the server changed.
Such deployments need an already-configured external bootstrap asset or a separate client update path.
This release does not promise automatic repair of every historical cache.

## Recovery bounds

The bootstrap checks at startup, while the page is visible every minute, and on focus, visibility changes, or reconnect, with automatic checks throttled to once per ten seconds.
Concurrent checks share one request.
Confirmed expiry records one attempt in session storage before any side effect, unregisters only the registration matching the app's controlling worker, and navigates to the protected destination.
An equal path/query forces a full reload instead of a fragment-only navigation.
Unrelated service-worker registrations and every cache remain intact.
The current document may remain controlled until it unloads, which is expected.

One automatic attempt is allowed per tab and probe URL until a later HTTP 204 confirms restored authentication.
A failed unregister, timeout, unavailable session storage, or repeated expiry stops automatic navigation.
When browser history restores a previous document from the back-forward cache, recovery discards its stale in-memory navigation state and probes again.
The retry budget stays in session storage until an exact HTTP 204 confirms restored authentication.
The configuration error screen retains its retry/offline options and reports recovery failure.
Its sign-in action ignores this budget, so a user can always leave a cached shell whose session expired while the tab was idle.
Closing the tab ends its session-storage budget; an explicit connection retry does not clear the budget.
Authentication policy and cross-tab coordination remain the deployment's responsibility.

## Validation

```sh
npm test
E2E_NO_WEB_SERVER=1 npm run test:e2e -- e2e/authentication-recovery.spec.ts
node --test scripts/test-authentication-recovery-nginx.mjs
npm run build # Netlify checks verify the generated deployment assets.
uv run --no-project python scripts/test_authentication_recovery_netlify.py
```

The browser suite starts its own loopback fixture and bundles actual Workbox legacy and current workers.
It reproduces marker-only legacy interception, recovers on normal relaunch for legacy/current/no-worker clients, and verifies storage and unrelated registrations survive.
The nginx test requires Docker and `nginx:alpine` and checks the actual image routes and runtime URL serialization.
Helm authentication policy belongs to the consuming chart; this repository contains no chart.
