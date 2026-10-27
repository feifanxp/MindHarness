# E2E Testing

This repo now has a local Playwright workflow that can test MindRoom against the
user's homeserver over `ssh mindroom`, without SSO.

The default assumptions in this file are intentionally opinionated:

- local machine: NixOS
- browser: system Chromium
- SSH host alias: `mindroom`
- remote homeserver bind: `http://localhost:8008`
- local forwarded homeserver: `http://127.0.0.1:8808`
- local app URL during tests: `http://127.0.0.1:4173`

These defaults are already baked into the scripts. Override them only if you
need to.

## What Exists

- `playwright.config.ts`
  - runs against local Vite preview by default
  - uses system Chromium on NixOS if available
  - supports `E2E_NO_WEB_SERVER=1` for already-running deployments
- `scripts/with-mindroom-tunnel.sh`
  - opens `localhost:8808 -> mindroom:localhost:8008`
- `scripts/create-mindroom-e2e-account.sh`
  - provisions a disposable Matrix account over `ssh mindroom`
- `scripts/test-e2e-mindroom.sh`
  - provisions disposable accounts if needed
  - opens the SSH tunnel
  - runs Playwright
- `e2e/password-login.spec.ts`
  - password login smoke test
- `e2e/auth-router.spec.ts`
  - direct router/auth path smoke test
- `e2e/multi-account.spec.ts`
  - second-account add-account flow
  - includes a stability window after second-account login to catch repeated
    `Heating up` / shell flicker
- `e2e/account-switching.spec.ts`
  - per-account route restore
  - reload persistence for the active account
  - inactive-account removal
- `e2e/account-logout.spec.ts`
  - logout fallback to the remaining stored account
  - final logout back to the auth shell
- `e2e/account-relogin.spec.ts`
  - add-account flow for the same Matrix user
  - proves existing stored sessions are updated instead of duplicated
- `e2e/account-three-account.spec.ts`
  - add third account
  - switch across three stored accounts
  - reload persistence with three-account state
- `e2e/account-storage.spec.ts`
  - inspects `localStorage` and IndexedDB lifecycle
  - verifies inactive-account removal and final logout clean up per-session stores
  - seeds legacy `cinny_*` keys and unrelated same-origin IndexedDB databases to
    verify destructive actions clear only the expected app-owned state
- `e2e/account-deactivation.spec.ts`
  - deactivates the currently active account from Settings -> Account
  - verifies only that account is removed locally while the other account stays
    signed in
  - verifies the deactivated account can no longer log in afterward
- `e2e/account-multitab.spec.ts`
  - validates account switching and logout propagation across two tabs
- `e2e/account-offline.spec.ts`
  - simulates homeserver outage while keeping the app origin alive
  - validates reconnect without a crash
- `e2e/deployed-auth-shell.spec.ts`
  - validates deployed `chat.lab.mindroom.chat` auth-route shells without needing SSO completion

## Requirements

Local machine:

- `ssh mindroom` must work without prompts during test runs
- system Chromium should exist at one of:
  - `/run/current-system/sw/bin/chromium`
  - `/run/current-system/sw/bin/chromium-browser`
- `npm install` must have been run

Remote host:

- `sudo -n true` must work for the SSH user
- the homeserver must be reachable on remote `localhost:8008`
- the runtime config must expose a registration token file

The provisioning helper currently reads:

- remote config path: `/run/tuwunel/tuwunel.toml`
- registration token path: discovered from that config

## Fast Start

Single-account smoke test:

```bash
./scripts/test-e2e-mindroom.sh e2e/password-login.spec.ts
```

Router smoke test:

```bash
./scripts/test-e2e-mindroom.sh e2e/auth-router.spec.ts
```

Multi-account reproduction:

```bash
E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/multi-account.spec.ts
```

Broader multi-account validation:

```bash
E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-switching.spec.ts
E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-logout.spec.ts
E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-deactivation.spec.ts
```

Three-account validation:

```bash
E2E_CREATE_SECOND_ACCOUNT=1 E2E_CREATE_THIRD_ACCOUNT=1 \
  ./scripts/test-e2e-mindroom.sh e2e/account-three-account.spec.ts
```

Storage and cleanup validation:

```bash
E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-storage.spec.ts
```

Multi-tab validation:

```bash
E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-multitab.spec.ts
```

Homeserver outage validation:

```bash
./scripts/test-e2e-mindroom.sh e2e/account-offline.spec.ts
```

Full local password-auth batch:

```bash
E2E_CREATE_SECOND_ACCOUNT=1 E2E_CREATE_THIRD_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh \
  e2e/password-login.spec.ts \
  e2e/auth-router.spec.ts \
  e2e/multi-account.spec.ts \
  e2e/account-switching.spec.ts \
  e2e/account-logout.spec.ts \
  e2e/account-deactivation.spec.ts \
  e2e/account-relogin.spec.ts \
  e2e/account-three-account.spec.ts \
  e2e/account-storage.spec.ts \
  e2e/account-multitab.spec.ts \
  e2e/account-offline.spec.ts
```

Headed mode:

```bash
./scripts/test-e2e-mindroom.sh --headed e2e/password-login.spec.ts
./scripts/test-e2e-mindroom.sh --headed e2e/auth-router.spec.ts
E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh --headed e2e/multi-account.spec.ts
```

Equivalent npm scripts:

```bash
npm run test:e2e:mindroom -- e2e/password-login.spec.ts
npm run test:e2e:mindroom -- e2e/auth-router.spec.ts
E2E_CREATE_SECOND_ACCOUNT=1 npm run test:e2e:mindroom -- e2e/multi-account.spec.ts
```

## Router Usage

The auth routes take the homeserver as an encoded router segment:

- login: `/login/:server/`
- register: `/register/:server/`
- reset password: `/reset-password/:server/`

The `:server` segment must be URL-encoded.

For the local SSH-tunneled homeserver, use:

- raw homeserver: `http://127.0.0.1:8808`
- encoded homeserver: `http%3A%2F%2F127.0.0.1%3A8808`

Literal route examples on the local app:

```text
http://127.0.0.1:4173/login/http%3A%2F%2F127.0.0.1%3A8808/
http://127.0.0.1:4173/login/http%3A%2F%2F127.0.0.1%3A8808/?addAccount=1
http://127.0.0.1:4173/register/http%3A%2F%2F127.0.0.1%3A8808/
http://127.0.0.1:4173/register/http%3A%2F%2F127.0.0.1%3A8808/?addAccount=1
http://127.0.0.1:4173/reset-password/http%3A%2F%2F127.0.0.1%3A8808/
http://127.0.0.1:4173/reset-password/http%3A%2F%2F127.0.0.1%3A8808/?addAccount=1
```

The Playwright helpers build these directly:

```ts
buildLoginPath('http://127.0.0.1:8808')
buildLoginPath('http://127.0.0.1:8808', true)
buildRegisterPath('http://127.0.0.1:8808')
buildResetPasswordPath('http://127.0.0.1:8808', true)
```

When debugging auth-router bugs, start from the direct route instead of clicking
through the UI. That avoids conflating router normalization bugs with earlier UI
state bugs.

## Disposable Accounts

The test runner will auto-create disposable accounts if these variables are not
already set:

- `E2E_USERNAME`
- `E2E_PASSWORD`

For multi-account:

- `E2E_SECOND_USERNAME`
- `E2E_SECOND_PASSWORD`

For three-account flows:

- `E2E_THIRD_USERNAME`
- `E2E_THIRD_PASSWORD`

Manual provisioning:

```bash
eval "$(./scripts/create-mindroom-e2e-account.sh E2E)"
eval "$(./scripts/create-mindroom-e2e-account.sh E2E_SECOND)"
eval "$(./scripts/create-mindroom-e2e-account.sh E2E_THIRD)"
```

If you want stable local credentials instead of disposable ones, hardcode them:

```bash
export E2E_USERNAME='codex-primary'
export E2E_PASSWORD='Pwlocalprimary123!'
export E2E_SECOND_USERNAME='codex-secondary'
export E2E_SECOND_PASSWORD='Pwlocalsecondary123!'
./scripts/test-e2e-mindroom.sh e2e/multi-account.spec.ts
```

If you want deterministic disposable account names:

```bash
E2E_ACCOUNT_USERNAME='codexdebug01' \
E2E_ACCOUNT_PASSWORD='Pwcodexdebug01!' \
./scripts/test-e2e-mindroom.sh e2e/password-login.spec.ts
```

## Running Against A Deployed Build

If the app is already deployed and you do not want Playwright to start the local
preview server:

```bash
E2E_NO_WEB_SERVER=1 \
E2E_BASE_URL='https://chat.lab.mindroom.chat' \
./scripts/test-e2e-mindroom.sh e2e/password-login.spec.ts
```

For direct route debugging against that deployment:

```bash
E2E_NO_WEB_SERVER=1 \
E2E_BASE_URL='https://chat.lab.mindroom.chat' \
./scripts/test-e2e-mindroom.sh e2e/auth-router.spec.ts
```

Deployed auth-shell validation without full SSO completion:

```bash
E2E_NO_WEB_SERVER=1 \
E2E_BASE_URL='https://chat.lab.mindroom.chat' \
E2E_HOMESERVER='https://mindroom.chat' \
./scripts/test-e2e-mindroom.sh e2e/deployed-auth-shell.spec.ts
```

Use this mode only if the deployed build can actually reach the homeserver URL
you pass in the router path. The safest reproducible path is still the local app
plus the SSH tunnel.

Important current lab behavior:

- `https://chat.lab.mindroom.chat/login/...` is SSO-only for `https://mindroom.chat`
- full deployed password-login automation is therefore not currently possible there
- deployed route-shell validation is still useful and is covered by `e2e/deployed-auth-shell.spec.ts`

## Useful Environment Variables

- `MINDROOM_SSH_HOST`
  - defaults to `mindroom`
- `MINDROOM_TUNNEL_PORT`
  - defaults to `8808`
- `MINDROOM_REMOTE_BIND`
  - defaults to `localhost`
- `MINDROOM_REMOTE_PORT`
  - defaults to `8008`
- `MINDROOM_REMOTE_CONFIG_PATH`
  - defaults to `/run/tuwunel/tuwunel.toml`
- `MINDROOM_REMOTE_BASE_URL`
  - defaults to `http://localhost:8008`
- `E2E_HOMESERVER`
  - defaults to `http://127.0.0.1:8808`
- `E2E_BASE_URL`
  - defaults to the local Playwright web server
- `E2E_NO_WEB_SERVER=1`
  - disables starting the local preview server

Example custom tunnel port:

```bash
MINDROOM_TUNNEL_PORT=9808 \
E2E_HOMESERVER='http://127.0.0.1:9808' \
./scripts/test-e2e-mindroom.sh e2e/password-login.spec.ts
```

## Recommended Agent Workflow

For one-off auth debugging:

1. Run `./scripts/test-e2e-mindroom.sh e2e/auth-router.spec.ts`.
2. If it fails, inspect router/query handling first.
3. Run `./scripts/test-e2e-mindroom.sh e2e/password-login.spec.ts`.
4. If login works, run the multi-account flow:
   - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/multi-account.spec.ts`
5. If add-account passes, run the broader account behaviors:
   - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-switching.spec.ts`
   - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-logout.spec.ts`
   - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-deactivation.spec.ts`
6. Expand to the full matrix only after the core flow is green:
   - `E2E_CREATE_SECOND_ACCOUNT=1 E2E_CREATE_THIRD_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-switching.spec.ts e2e/account-logout.spec.ts e2e/account-deactivation.spec.ts e2e/account-relogin.spec.ts e2e/account-three-account.spec.ts e2e/account-storage.spec.ts e2e/account-multitab.spec.ts e2e/account-offline.spec.ts`
7. Inspect `LIVE_BROWSER_VALIDATION.md` to compare your current result against the last recorded one-off pass.

For headed debugging:

1. Run the same spec with `--headed`.
2. Keep the tunnel-managed homeserver URL.
3. Paste the explicit auth route URL into the address bar when needed.

For deployed-build verification:

1. Set `E2E_NO_WEB_SERVER=1`.
2. Set `E2E_BASE_URL` to the deployed app.
3. Prefer `e2e/auth-router.spec.ts` first, then `e2e/password-login.spec.ts`.

## Known Current State

- `e2e/password-login.spec.ts`
  - expected to pass locally against the SSH-tunneled homeserver
- `e2e/auth-router.spec.ts`
  - expected to pass locally
- `e2e/multi-account.spec.ts`
  - expected to pass locally
  - specifically verifies that `Add account` preserves the active explicit
    homeserver instead of snapping back to the default server
  - also samples the shell for several seconds after second-account login so it
    catches client re-bootstrap loops instead of only checking "eventually
    loaded"
- `e2e/account-switching.spec.ts`
  - expected to pass locally
  - verifies route restore between `/home/create/` and `/home/join/`
  - verifies the active account and route survive a full browser reload
  - verifies removing an inactive account updates the account rail correctly
- `e2e/account-logout.spec.ts`
  - expected to pass locally
  - verifies logging out the active account falls back to the remaining stored
    account
  - verifies logging out the last stored account returns to the auth shell
- `e2e/account-deactivation.spec.ts`
  - expected to pass locally
  - verifies deactivating the active account from Settings removes only that
    account locally
  - verifies the remaining stored account stays signed in
  - verifies the deactivated account can no longer log in afterward

Observed live diagnostics on the local Vite + SSH-tunnel setup:

- Console logs are noisy even on passing runs.
- Common non-critical messages during switch/reload/logout:
  - `turnServer` `404` / `Failed to get TURN URIs`
  - `dev-sw` service-worker registration failures in local dev mode
  - aborted `/sync` requests during account switches, reloads, and logout
- The browser helpers only fail on critical regression signatures such as:
  - `Unexpected Application Error!`
  - `MatrixClient not initialized!`
  - session-store / rust-crypto account mismatch errors
  - render-loop / initialization-order crashes

Treat the multi-account spec as a live regression test for account-switcher
auth routing.
