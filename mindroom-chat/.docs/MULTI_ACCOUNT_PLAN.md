# Multi-Account Support Plan

## Purpose

This document is the detailed design reference for adding multi-account support
to MindRoom Chat.

This feature is large and invasive. The goal of this document is to make the
scope explicit before implementation so we do not drift into an accidental
rewrite or a half-single-account/half-multi-account state.

Design decision already made:

- No legacy session migration.
- Existing users can sign in again after the feature lands.
- The first multi-account version should be clean, not compatibility-heavy.

## Problem Statement

What we want:

- Multiple Matrix accounts on the same device/browser.
- Multiple avatars visible in the bottom sidebar area.
- Fast account switching.
- Different accounts may live on different homeservers.

What is true today:

- The app is built around one active `MatrixClient`.
- Session boot is keyed off one fallback session in localStorage.
- Matrix SDK stores and our custom room/thread caches are singleton-scoped.
- Some integrations still read one global token/base URL directly.

Why this matters:

- A naive UI-only account switcher would be misleading and fragile.
- Without storage isolation, accounts will leak into each other.
- Without a first-class session registry, login/logout/switch flows will remain
  ad hoc and hard to reason about.

## Current Architecture Constraints

The current codebase assumes one active account in these areas:

- Session persistence:
  - `src/app/state/sessions.ts`
  - fallback keys: `cinny_access_token`, `cinny_device_id`, `cinny_user_id`,
    `cinny_hs_base_url`
- Auth completion:
  - `src/app/pages/auth/login/loginUtil.ts`
  - `src/app/pages/auth/register/registerUtil.ts`
- App boot and route gating:
  - `src/app/pages/Router.tsx`
  - `src/app/pages/client/ClientRoot.tsx`
  - `src/app/pages/client/SpecVersions.tsx`
  - `src/app/pages/afterLoginRedirectPath.ts`
- Config-time session reconciliation:
  - `src/app/components/ClientConfigLoader.tsx`
- Active client context:
  - `src/app/hooks/useMatrixClient.ts`
- Matrix SDK store naming:
  - `src/client/initMatrix.ts`
  - current DB names: `web-sync-store`, `crypto-store`
- Custom room/thread caches:
  - `src/app/features/room/roomEventCache.ts`
  - `src/app/features/room/threadEventCache.ts`
- Service worker media auth:
  - `src/index.tsx`
  - `src/sw-session.ts`
  - `src/sw.ts`
- Token-derived media URL fallback:
  - `src/app/utils/mediaUrl.ts`
- iOS push state:
  - `src/app/utils/iosPush.ts`
  - `src/app/pages/client/ClientNonUIFeatures.tsx`
- Logout and cache clearing:
  - `src/client/initMatrix.ts`
  - `src/app/components/LogoutDialog.tsx`
- Sidebar account UI:
  - `src/app/pages/client/sidebar/SettingsTab.tsx`
  - `src/app/pages/client/SidebarNav.tsx`
  - `src/app/features/settings/Settings.tsx`

Some state is already safer than expected:

- Several UI preference atoms are keyed by `userId`, for example:
  - `src/app/state/navToActivePath.ts`
  - `src/app/state/closedNavCategories.ts`
  - `src/app/state/closedLobbyCategories.ts`
  - `src/app/state/openedSidebarFolder.ts`
- Those do not need a ground-up redesign, but they must keep working when the
  active account changes.

## Scope

Phase 1 scope:

- Multiple stored accounts.
- One active `MatrixClient` at a time.
- Add account.
- Switch account.
- Logout one account without deleting all accounts.
- Session-scoped Matrix SDK stores.
- Session-scoped room/thread caches.
- Session-scoped service-worker auth state.
- Session-scoped iOS push local state.
- Sidebar account UI at the bottom.

Explicit non-goals for phase 1:

- No simultaneous live sync for multiple accounts.
- No merged unread counts across accounts.
- No cross-account inbox.
- No cross-account search.
- No silent background refresh for inactive accounts.
- No attempt to preserve current users' legacy fallback session automatically.

## Core Architectural Decision

Phase 1 will keep the app's single-active-client programming model.

That means:

- the app still renders from one `MatrixClientProvider`
- almost all existing components/hooks continue to call `useMatrixClient()`
- switching accounts means replacing the active client cleanly
- inactive accounts remain persisted, but are not live-synced in memory

Why this is the right design:

- It is much smaller than multi-client concurrent rendering.
- It preserves the existing mental model of the app.
- It avoids a large unread/notification/state fan-out rewrite.
- It is easier to validate on iOS.

## Session Model

Introduce a dedicated persisted registry:

```ts
type StoredSession = {
  sessionId: string;
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  lastUsedAt: number;
  lastKnownDisplayName?: string;
  lastKnownAvatarUrl?: string;
};

type MultiAccountStore = {
  version: 1;
  activeSessionId?: string;
  sessions: StoredSession[];
};
```

Rules:

- `sessionId` must be stable and opaque.
- `sessionId` should not depend on mutable profile state.
- The registry becomes the only source of truth for stored accounts.
- The old fallback session keys stop being a supported boot path.

Recommended implementation:

- store the registry in one localStorage key, for example
  `mindroom_multi_account_store`
- expose helpers such as:
  - `getSessionStore()`
  - `getActiveSession()`
  - `putSession(session)`
  - `removeSession(sessionId)`
  - `setActiveSession(sessionId)`
  - `listSessions()`
  - `clearAllSessions()`

## Storage Isolation

This feature is not correct unless session-bound persistence is namespaced.

### Matrix SDK stores

Current:

- `web-sync-store`
- `crypto-store`

Target:

- `web-sync-store::<sessionId>`
- `crypto-store::<sessionId>`

Required change:

- `src/client/initMatrix.ts` must receive store names derived from the active
  session instead of using singleton constants.

### Custom room/thread caches

Current:

- `mindroom-room-event-cache`
- `mindroom-thread-event-cache`

Target:

- `mindroom-room-event-cache::<sessionId>`
- `mindroom-thread-event-cache::<sessionId>`

Required changes:

- `src/app/features/room/roomEventCache.ts`
- `src/app/features/room/threadEventCache.ts`

Both modules need:

- a way to derive the DB name from the active session
- session-aware delete/clear operations
- call sites updated so they operate on the selected account only

### Local storage keys

Current global keys that must stop acting as the active source of truth:

- `cinny_access_token`
- `cinny_device_id`
- `cinny_user_id`
- `cinny_hs_base_url`

Likely session-bound keys that also need redesign:

- `mindroom_ios_push_token`
- `mindroom_ios_push_profile_tag`

Current user-scoped keys that can likely remain as-is:

- navigation atoms keyed by `userId`

## Boot Flow

### Current flow

1. Router checks `getFallbackSession()`.
2. ClientRoot initializes one client from that fallback session.
3. App renders or redirects to login.

### Target flow

1. Router checks the persisted session registry.
2. If there is no active stored account:
   - go to auth routes
3. If there is an active stored account:
   - initialize the client for that session
   - provide it through `MatrixClientProvider`
4. If the active session is invalid:
   - show a recoverable error state
   - allow switching to another stored account or removing the broken one

Required files:

- `src/app/pages/Router.tsx`
- `src/app/pages/client/ClientRoot.tsx`
- `src/app/state/sessions.ts`
- `src/app/pages/client/SpecVersions.tsx`
- `src/app/pages/afterLoginRedirectPath.ts`
- `src/app/components/ClientConfigLoader.tsx`

Required cleanup:

- `ClientConfigLoader.tsx` currently calls
  `reconcileFallbackSessionHomeserver(config)`. That logic must be removed or
  replaced; it only makes sense in the old fallback single-session model.
- `SpecVersions.tsx` currently handles "Cancel and return to sign in" by calling
  `removeFallbackSession()`. In the multi-account world, this must become an
  active-session-aware recovery path.
- `ClientRoot.tsx` currently handles `SessionLoggedOut` by clearing all
  localStorage. That must become targeted cleanup for the active or broken
  session only.

## Account Switching Flow

Target switch behavior:

1. User clicks a secondary avatar in the sidebar.
2. App enters a short "switching account" state.
3. Current client stops cleanly.
4. Active session id is updated.
5. New client is initialized with that session's stores.
6. Service worker and native integrations receive the new active session.
7. App navigates to that session's remembered path or a safe fallback.

Rules:

- Switching accounts must not clear all localStorage.
- Switching accounts must not delete other sessions' DBs.
- Switching should preserve per-account nav state when possible.
- Switching should be explicit in UI; no hidden full-page logout/login trick.

Recommended implementation shape:

- add a small client-session controller in `ClientRoot` or a dedicated hook,
  for example `useActiveSessionClient()`
- centralize the stop/load/start transition there
- avoid scattering session-switch orchestration across sidebar and auth code

## Auth And Add-Account Flow

Current auth completion writes one fallback session:

- `src/app/pages/auth/login/loginUtil.ts`
- `src/app/pages/auth/register/registerUtil.ts`

Target behavior:

- successful login/register adds or updates one `StoredSession`
- the new account becomes active
- the previous accounts remain stored

Required changes:

- replace `setFallbackSession(...)` with `putSession(...)` plus
  `setActiveSession(...)`
- make sure add-account can be started while already signed in
- keep the login and registration screens reusable for first-account and
  add-account flows

Required routing/redirect changes:

- the current auth routing assumes "if any session exists, redirect away from
  login/register"
- add-account mode needs an explicit route or state path that remains reachable
  while already signed in
- `afterLoginRedirectPath.ts` may need separate semantics for:
  - boot-time unauthenticated redirect
  - add-account flow started from inside the app

Likely UI addition:

- `Add account` entry point in the bottom sidebar account menu

## Sidebar And Settings UI

Current state:

- bottom avatar in `SettingsTab.tsx` is only a settings launcher

Target state:

- bottom section becomes an account rail / account switcher
- active account is visually obvious
- recent accounts are quickly accessible
- settings remain reachable from the active account affordance

Suggested UI:

- active avatar button
- 2-4 secondary account avatars
- `+` button
- menu or bottom sheet with:
  - switch account
  - open settings for active account
  - add account
  - logout this account

Required files:

- `src/app/pages/client/sidebar/SettingsTab.tsx`
- `src/app/pages/client/SidebarNav.tsx`
- likely one or more new components, for example:
  - `src/app/pages/client/sidebar/AccountSwitcher.tsx`
  - `src/app/pages/client/sidebar/AccountAvatarRail.tsx`

## Logout, Removal, And Cache Clearing

Current behavior is globally destructive in some paths:

- `logoutClient()` clears stores and then `window.localStorage.clear()`
- `clearLoginData()` deletes all indexedDB databases and clears localStorage

That is incompatible with multi-account support.

Target semantics:

- `Logout this account`
  - logs out selected session server-side if possible
  - removes only that session's local data
  - keeps other stored accounts
- `Clear cache for this account`
  - deletes only that session's sync/crypto/custom cache DBs
- optional later action: `Remove all accounts and local data`

Required changes:

- `src/client/initMatrix.ts`
- `src/app/components/LogoutDialog.tsx`
- settings/about clear-cache entry points
- `src/app/pages/client/ClientRoot.tsx`

Important detail:

- account cleanup must operate by `sessionId`, not just by currently mounted
  `MatrixClient`, because account removal may happen for inactive accounts too

Recommended phase 1 simplification:

- full server-side logout should only be offered for the active account
- inactive accounts can support `Remove from device` first, unless we later add
  a deliberate headless-client logout path

## Service Worker And Media Auth

Current state:

- `src/index.tsx` posts one global session to the service worker
- `src/sw.ts` stores one session per browser client/tab
- `src/app/utils/mediaUrl.ts` may read `cinny_access_token` directly

Target behavior:

- service worker receives the active session from the session registry
- media URL helpers resolve the active session token without global fallback
- switching accounts immediately updates service worker auth state

Required files:

- `src/index.tsx`
- `src/sw-session.ts`
- `src/sw.ts`
- `src/app/utils/mediaUrl.ts`

Important note:

- the service worker is scoped per tab/client already, which is good
- the missing piece is the source of truth for the active session credentials

## iOS Push And Native State

Current state:

- `src/app/utils/iosPush.ts` stores one global push token/profile tag
- `ClientNonUIFeatures.tsx` registers the active account's pusher

Problems:

- one global local key is not correct for multiple accounts
- removing one account should not blindly clear another account's pusher state

Target behavior:

- local push token/profile metadata is stored per session
- pusher registration and removal are per account
- logging out account A should not remove account B's registration

Required files:

- `src/app/utils/iosPush.ts`
- `src/app/pages/client/ClientNonUIFeatures.tsx`
- notification settings UI under `src/app/features/settings/notifications/`

Open product question:

- do we want all stored accounts to remain push-enabled, or only the active one?
- recommended phase 1 answer: allow per-account pusher registrations, because
  push is server-side and should not require all accounts to be active in-app

## Caches And Account Metadata

We need two separate concepts:

1. heavy data stores
   - sync store
   - crypto store
   - room history cache
   - thread history cache
2. light account metadata for the switcher UI
   - avatar URL
   - display name
   - homeserver
   - last used time

The account switcher should not need a full Matrix client startup just to render
the list of stored accounts.

Recommended approach:

- persist light account metadata in the session registry
- refresh it opportunistically from the live active client
- allow stale metadata in the switcher until the account becomes active again

Important avatar caveat:

- inactive-account avatars cannot rely on the current active account's media
  token
- if account B's avatar requires authentication, account A's token cannot fetch
  it safely
- phase 1 therefore needs one explicit strategy:
  - either persist a tiny account-avatar thumbnail cache per session for the
    switcher, or
  - show initials for inactive accounts when no cached thumbnail is available

Recommended phase 1 answer:

- store display name plus optional small cached avatar thumbnail for switcher
  rendering
- fall back to initials if that thumbnail is missing

## Failure Modes To Design For

- invalid token for one stored account
- corrupted store for one account
- homeserver unreachable for one account
- switching away while the current client is still starting
- logout failing server-side but local cleanup still needed
- account removal for encrypted accounts with warnings
- same `userId` on different homeservers
- duplicate account add for same `{baseUrl,userId,deviceId}` tuple

Required UX stance:

- one broken account must not brick the entire app
- the user must always have a route to:
  - switch accounts
  - remove the broken account
  - sign in again

## Testing Plan

Minimum required coverage:

- session registry CRUD
- active-session resolution
- Router auth gating from registry instead of fallback session
- ClientRoot switching flow
- per-session store-name derivation
- per-session cache deletion
- login completion adds account instead of replacing all state
- logout removes one account only
- service-worker session posting uses active session
- iOS push local keys are session-aware
- sidebar account switcher interactions

Useful targeted tests:

- account switch preserves per-user nav state
- removing active account selects next recent account
- removing last account returns to auth routes
- broken session at boot does not trap the app in a crash loop
- inactive-account switcher avatar falls back cleanly when no cached thumbnail
  exists
- SpecVersions cancel path removes only the active or broken session
- ClientConfigLoader no longer mutates fallback-session keys

## Implementation Phases

Recommended commit sequence:

1. `feat(accounts): add persisted session registry`
   - add new data model and helpers
   - remove fallback-session source-of-truth assumption
2. `feat(accounts): namespace matrix and cache stores by session`
   - SDK stores
   - room/thread cache DB names
   - cleanup helpers
3. `feat(accounts): boot client from active session registry`
   - Router
   - ClientRoot
   - active-session controller
4. `feat(accounts): add switch-account and add-account flows`
   - login/register completion
   - active-session mutation
5. `feat(sidebar): add account switcher rail`
   - bottom avatars
   - add-account button
   - account menu
6. `feat(accounts): make media and push helpers session-aware`
   - service worker
   - media URL fallback
   - iOS push local state
7. `test(accounts): add switching and cleanup regressions`

This order matters:

- phases 1 through 3 create correctness
- phases 4 and 5 make the feature visible
- phase 6 fixes integrations that would otherwise behave incorrectly

## Estimated Complexity

This is a real subsystem change, not a small feature.

Rough estimate:

- pragmatic first version: about 1 to 2 weeks
- careful hardening and polish: about 2 to 3 weeks

Main complexity drivers:

- boot flow rewrite
- per-session data isolation
- logout/cache-clear semantics
- service-worker and iOS push side effects
- keeping the rest of the app on a simple single-active-client model

## Open Questions

- Should switching accounts preserve the last route per account exactly, or only
  per top-level section?
- Do we want a visible homeserver label in the account menu for same-named
  accounts on different servers? Probably yes.
- Should `Add account` reuse the existing auth pages in-place or open a modal
  overlay? Reusing the auth pages is simpler and cleaner.
- Do we want inactive accounts to show stale unread badges in the switcher?
  Recommended answer for phase 1: no.
- What should happen across multiple browser tabs?
  Recommended answer for phase 1: store one persisted default active session for
  future boots, but do not force already-open tabs to hot-swap accounts unless
  the user explicitly switches in that tab.

## Recommendation

Proceed, but treat this as an architectural project with a narrow first release.

The clean version is:

- no legacy migration
- no concurrent multi-client runtime
- strict session-scoped storage
- explicit account switcher UI

Anything more ambitious than that in phase 1 will raise maintenance cost
sharply.
