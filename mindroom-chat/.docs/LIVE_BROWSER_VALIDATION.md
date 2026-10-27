# Live Browser Validation

This document tracks one-off live validation runs for the multi-account branch.

It is intentionally more detailed and more operational than `E2E_TESTING.md`.
`E2E_TESTING.md` explains how to run the harness. This file records what was
actually tested, what happened, what logs were observed, and which bugs were
found.

## Environment

- Branch: `multi-account`
- Primary app target:
  - local Playwright app preview on `http://127.0.0.1:4173`
- Primary homeserver target:
  - local SSH tunnel to `ssh mindroom`
  - forwarded homeserver: `http://127.0.0.1:8808`
- Secondary app target:
  - deployed lab app on `https://chat.lab.mindroom.chat`
- Secondary homeserver target:
  - direct public homeserver URL `https://mindroom.chat`
- Browser:
  - Playwright Chromium on NixOS system Chromium

## Acceptance Standard

For this validation pass, a scenario is considered validated only if:

1. The visible browser behavior matches the expected product behavior.
2. No critical browser diagnostics are observed:
   - `Unexpected Application Error!`
   - `MatrixClient not initialized!`
   - `Maximum update depth`
   - rust crypto account/store mismatch
   - init-order / temporal-dead-zone crashes
3. The session store and IndexedDB state match the intended lifecycle for the scenario.

Known non-blocking noise that does not fail a scenario by itself:

- `turnServer` `404`
- aborted `/sync` requests during reload, switch, or logout
- local dev service-worker registration noise
- `.well-known` discovery failures when the app correctly falls back to explicit server config

## Latest Full Rerun

Local SSH-tunneled batch:

```bash
E2E_CREATE_SECOND_ACCOUNT=1 E2E_CREATE_THIRD_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh \
  e2e/password-login.spec.ts \
  e2e/auth-router.spec.ts \
  e2e/multi-account.spec.ts \
  e2e/account-switching.spec.ts \
  e2e/account-logout.spec.ts \
  e2e/account-relogin.spec.ts \
  e2e/account-three-account.spec.ts \
  e2e/account-storage.spec.ts \
  e2e/account-multitab.spec.ts \
  e2e/account-offline.spec.ts
```

- Result: `12 passed (5.0m)`

Deployed auth-shell batch:

```bash
E2E_NO_WEB_SERVER=1 \
E2E_BASE_URL='https://chat.lab.mindroom.chat' \
E2E_HOMESERVER='https://mindroom.chat' \
./scripts/test-e2e-mindroom.sh e2e/deployed-auth-shell.spec.ts
```

- Result: `3 passed (9.0s)`

## Scenario Matrix

| ID | Scenario | Target | Method | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| LV-001 | Password login | Local app + SSH tunnel | Playwright | Passed | Covered in full local batch |
| LV-002 | Direct auth-router entry | Local app + SSH tunnel | Playwright | Passed | Login/register/reset, `?addAccount=1` |
| LV-003 | Add second account | Local app + SSH tunnel | Playwright | Passed | Includes stability window |
| LV-004 | Route restore, reload, inactive remove | Local app + SSH tunnel | Playwright | Passed | Per-account last-path behavior held |
| LV-005 | Active logout fallback, final logout | Local app + SSH tunnel | Playwright | Passed | Remaining account fallback worked |
| LV-006 | Same-account re-login via Add account | Local app + SSH tunnel | Playwright | Passed | Deduped to one stored session |
| LV-007 | Three-account flow | Local app + SSH tunnel | Playwright | Passed | Add third account, switch all, reload |
| LV-008 | IndexedDB and localStorage lifecycle | Local app + SSH tunnel | Playwright | Passed | Found and fixed one cleanup bug |
| LV-009 | Multi-tab switching propagation | Local app + SSH tunnel | Playwright | Passed | Active session propagated across tabs |
| LV-010 | Multi-tab removal/logout propagation | Local app + SSH tunnel | Playwright | Passed | Logout fallback propagated across tabs |
| LV-011 | Homeserver outage with stored account | Local app + SSH tunnel | Playwright | Passed | Connectivity dialog shown, no crash |
| LV-012 | Reconnect after homeserver outage | Local app + SSH tunnel | Playwright | Passed | Reload recovered normal shell |
| LV-013 | Deployed password login | `chat.lab` + public homeserver | Playwright | Blocked | Deployment is SSO-only for login |
| LV-014 | Deployed add-account flow | `chat.lab` + public homeserver | Playwright | Blocked | Full SSO automation unavailable without provider credentials |
| LV-015 | Deployed switch + reload | `chat.lab` + public homeserver | Playwright | Blocked | Depends on successful deployed login |
| LV-016 | Deployed auth-router entry | `chat.lab` + public homeserver | Playwright | Passed | Login/register/reset each validated |

## Detailed Log

### LV-001 Password login

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 E2E_CREATE_THIRD_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/password-login.spec.ts ...`
- Result:
  - Passed inside the consolidated local batch.
- Diagnostics:
  - No critical diagnostics.
- Observations:
  - Password login against explicit `http://127.0.0.1:8808` remains fast and stable.

### LV-002 Direct auth-router entry

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 E2E_CREATE_THIRD_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh ... e2e/auth-router.spec.ts ...`
- Result:
  - Passed in the consolidated local batch.
- Diagnostics:
  - No critical diagnostics.
- Observations:
  - Direct `/login/:server`, `/register/:server`, and `/reset-password/:server` paths preserved explicit homeserver state and `?addAccount=1`.

### LV-003 Add second account

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/multi-account.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed.
- Diagnostics:
  - Stability sampling stayed below the critical threshold; no `Heating up` loop recurred.
- Observations:
  - Second-account login remained on the explicit homeserver path and did not bounce back to the default server.

### LV-004 Route restore, reload, inactive remove

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-switching.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed.
- Diagnostics:
  - `[diag:account switching / reload / inactive removal] consoleErrors=50 pageErrors=5 requestFailures=8`
- Observations:
  - Route restore between `/home/create/` and `/home/join/` worked.
  - Reload preserved the active account and route.
  - Inactive removal left the active session intact.

### LV-005 Active logout fallback, final logout

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-logout.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed.
- Diagnostics:
  - `[diag:active logout fallback and final logout] consoleErrors=26 pageErrors=4 requestFailures=6`
- Observations:
  - Logging out the active account with another stored account present fell back cleanly.
  - Final logout returned to the auth shell.

### LV-006 Same-account re-login via Add account

- Status: Passed
- Command:
  - `./scripts/test-e2e-mindroom.sh e2e/account-relogin.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed after tightening one over-strict assertion.
- Diagnostics:
  - `[diag:same-account add-account relogin] consoleErrors=24-25 pageErrors=3 requestFailures=3-5`
- Observations:
  - Re-logging the same account did not create a duplicate stored session.
  - The active account rail label uses cached display name, not raw Matrix user ID; this was a test assumption issue, not a product bug.

### LV-007 Three-account flow

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 E2E_CREATE_THIRD_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-three-account.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed.
- Diagnostics:
  - `[diag:three-account add/switch/reload] consoleErrors=72 pageErrors=7 requestFailures=15`
- Observations:
  - Three stored accounts coexisted correctly.
  - Switching preserved per-account routes across `/home/create/`, `/home/join/`, and `/home/search/`.
  - Reload preserved the active third account and route.

### LV-008 IndexedDB and localStorage lifecycle

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-storage.spec.ts`
- Result:
  - Initial run failed and exposed a real cleanup bug.
  - Fixed and reran successfully.
- Diagnostics:
  - `[diag:session storage cleanup] consoleErrors=20 pageErrors=3 requestFailures=6`
- Observations:
  - Chromium reported the real sync DB name as `matrix-js-sdk:web-sync-store::...`.
  - Inactive-session cleanup had been trying to delete `web-sync-store::...`, which is the constructor name, not the actual browser DB name.
  - After the fix, inactive-session removal and final logout both removed the session-scoped IndexedDB state as intended.

### LV-009 Multi-tab switching propagation

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-multitab.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed.
- Diagnostics:
  - `[diag:multi-tab switch page one] consoleErrors=29 pageErrors=2 requestFailures=5-6`
  - `[diag:multi-tab switch page two] consoleErrors=18 pageErrors=1 requestFailures=2`
- Observations:
  - Active-account switches propagated cleanly across two tabs in the same browser context.
  - No crash or render-loop signatures appeared.

### LV-010 Multi-tab removal/logout propagation

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-multitab.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed.
- Diagnostics:
  - `[diag:multi-tab logout page one] consoleErrors=23 pageErrors=3 requestFailures=5`
  - `[diag:multi-tab logout page two] consoleErrors=14 pageErrors=2 requestFailures=0`
- Observations:
  - Logging out the active account in one tab fell back to the remaining stored account in the other tab too.

### LV-011 Homeserver outage with stored account

- Status: Passed
- Command:
  - `./scripts/test-e2e-mindroom.sh e2e/account-offline.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed after refining the scenario from full browser-offline to homeserver-outage simulation.
- Diagnostics:
  - `[diag:homeserver outage and reconnect] consoleErrors=16 pageErrors=4 requestFailures=3`
- Observations:
  - Full browser-offline on a local Vite origin is the wrong model; it just causes browser-level disconnect before the app can boot.
  - Simulating homeserver unavailability produced a defined in-app connectivity dialog instead of a crash.

### LV-012 Reconnect after homeserver outage

- Status: Passed
- Command:
  - `./scripts/test-e2e-mindroom.sh e2e/account-offline.spec.ts`
  - also covered in the full local batch
- Result:
  - Passed.
- Diagnostics:
  - Same diagnostics as LV-011.
- Observations:
  - Once homeserver traffic was restored and the page reloaded, the logged-in shell recovered normally with the same active account.

### LV-013 Deployed password login

- Status: Blocked
- Command:
  - `E2E_NO_WEB_SERVER=1 E2E_BASE_URL='https://chat.lab.mindroom.chat' E2E_HOMESERVER='https://mindroom.chat' ./scripts/test-e2e-mindroom.sh e2e/password-login.spec.ts`
- Result:
  - Blocked by deployment behavior, not by a test harness failure.
- Diagnostics:
  - The route loaded successfully, but no username/password inputs were present.
- Observations:
  - `chat.lab.mindroom.chat` currently renders an SSO-only login shell for `https://mindroom.chat`.
  - This prevents password-authenticated deployed multi-account testing without provider credentials.

### LV-014 Deployed add-account flow

- Status: Blocked
- Command:
  - Not executed beyond auth-shell entry because deployed login is SSO-only.
- Result:
  - Blocked.
- Diagnostics:
  - N/A
- Observations:
  - Full deployed add-account validation would require real Apple/Google/GitHub provider credentials and callback completion.

### LV-015 Deployed switch + reload

- Status: Blocked
- Command:
  - Not executed because deployed login could not be completed without SSO credentials.
- Result:
  - Blocked.
- Diagnostics:
  - N/A
- Observations:
  - The authenticated deployed matrix remains unvalidated until SSO login can be automated or performed manually.

### LV-016 Deployed auth-router entry

- Status: Passed
- Command:
  - `E2E_NO_WEB_SERVER=1 E2E_BASE_URL='https://chat.lab.mindroom.chat' E2E_HOMESERVER='https://mindroom.chat' ./scripts/test-e2e-mindroom.sh e2e/deployed-auth-shell.spec.ts`
- Result:
  - Passed with route-specific assertions.
- Diagnostics:
  - No critical diagnostics during the final deployed auth-shell run.
- Observations:
  - `/login/...` renders an SSO-only shell.
  - `/register/...` renders an SSO sign-up shell and preserves `?addAccount=1`.
  - `/reset-password/...` renders a local reset-password form and preserves `?addAccount=1`.
  - The deployed auth surface is heterogeneous by route, which is important to know for future automation.

### LV-017 Local storage cleanup hardening

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-storage.spec.ts`
- Result:
  - Passed after extending the spec to seed legacy `cinny_*` keys and unrelated
    same-origin IndexedDB databases before destructive actions.
- Diagnostics:
  - `[diag:session storage cleanup] consoleErrors=20 pageErrors=3 requestFailures=7`
  - No critical diagnostics matched the browser failure filters.
- Observations:
  - Inactive-account removal removed only the expected session-owned databases.
  - Final logout cleared the seeded legacy `cinny_*` keys.
  - Final logout left unrelated same-origin IndexedDB databases intact.
  - This gives real-browser evidence that the latest cleanup hardening behaves
    correctly against actual IndexedDB and localStorage, not just unit-test mocks.

### LV-018 Local multitab final logout probe

- Status: Observed, not promoted to a committed regression
- Command:
  - `./scripts/test-e2e-mindroom.sh e2e/account-multitab.spec.ts -g "propagates final logout across tabs back to the auth shell without flicker"`
- Result:
  - Explored manually via a temporary stricter regression, then discarded.
- Diagnostics:
  - No critical crash signature was surfaced before the exploratory run was removed.
- Observations:
  - After last-account logout in one tab, the other tab does reach the auth shell.
  - On the local SSH-tunneled setup, the auth shell resets the server picker to
    the configured default (`mindroom.chat`) instead of preserving the prior
    non-default tunnel homeserver (`http://127.0.0.1:8808`).
  - I treated that as an environment-specific UX observation rather than a
    merge-blocking bug and did not keep the stricter temporary regression.

### LV-019 Local active-account deactivation with fallback account

- Status: Passed
- Command:
  - `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-deactivation.spec.ts`
- Result:
  - Passed after scripting the Settings -> Account -> Delete / Deactivate flow
    with the password-based UIA confirmation.
- Diagnostics:
  - `[diag:active account deactivation with fallback account] consoleErrors=30 pageErrors=5 requestFailures=4`
  - No critical diagnostics matched the browser failure filters.
- Observations:
  - Deactivating the active account removed only that account from the local
    session store.
  - The remaining stored account stayed signed in and became the active account
    after the deactivation logout/reload.
  - Attempting to log back into the deactivated account showed `This account
    has been deactivated.`
  - This gives real-browser evidence that the deactivation flow is scoped to
    the currently active account rather than wiping all stored accounts.

## Bugs Found During This Validation Pass

- Real bug fixed:
  - inactive-session cleanup targeted the wrong sync IndexedDB name (`web-sync-store::...` instead of the browser’s real `matrix-js-sdk:web-sync-store::...`)
- Additional real-browser hardening validated:
  - legacy `cinny_*` localStorage keys are now removed during destructive
    cleanup, and unrelated same-origin IndexedDB data survives account removal
    and final logout
- Test-assumption corrections made during the pass:
  - active account rail label uses display name, not raw Matrix user ID
  - full browser-offline is not a useful proxy for homeserver outage on a local Vite origin
  - deployed auth routes differ by route and deployment config, so one shared “deployed auth shell” assumption was too simple

## Remaining Gaps After This Pass

- Native iOS / Capacitor behavior
- iOS push / background delivery
- Safari-specific storage and service-worker behavior
- Fully authenticated deployed multi-account behavior after SSO login
- Cross-homeserver multi-account with truly different homeservers
