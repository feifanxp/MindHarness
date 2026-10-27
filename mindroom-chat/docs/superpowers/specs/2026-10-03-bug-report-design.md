# One-Click Bug Reports Design

## Goal

Let any MindRoom Chat user report a problem with one click on a message.
The report reaches the deployment's administrator with everything needed to reconstruct what happened: the identifiers of the room, thread, and message, the events as this client holds them (original content plus latest edit), client state, and the existing diagnostics export.
The administrator hands the report to a coding agent, together with the backend data collected by `mindroom debug-report` (separate PR in the `mindroom` repository).

## Trust model

- The administrator may read everything; no field is redacted.
- Users have privacy from each other: a report is visible only to its reporter and the administrators.
- The reporter explicitly chooses to send the report, so sending thread content to the administrator is user-initiated.

## User experience

### Reporter

1. The message menu has a **Report a bug** item on every message, including failed and pending local echoes.
2. One click sends the report; there is no dialog and nothing to accept.
3. While sending, the item shows `Sending report…` and is disabled.
4. On success the menu closes and the app opens the report's thread in the reporter's private report room.
   The thread already contains the summary and the attached JSON, and the reporter may type extra context there.
5. On failure the item shows `Couldn't send the report. Try again.` and stays clickable; a retry reuses the room if it was already created.

When the homeserver does not configure administrators, the same item is labelled **Download bug report** and saves the JSON file instead (`saveFile`, the same path the diagnostics export uses).

### Administrator

- The administrator's MindRoom Chat client joins report-room invites automatically, so the administrator never accepts an invite either.
- If the administrator is offline, the invite waits until their client next syncs; the report is already stored in the room.
- Each reporter has one room; each report is one thread in it.

## Configuration

Administrators are configured per homeserver in `/.well-known/matrix/client`:

```json
{
  "m.homeserver": { "base_url": "https://matrix.company.com" },
  "io.mindroom.bug_reports": { "admins": ["@admin:company.com"] }
}
```

- The client already fetches this document after login and exposes custom keys through `useAutoDiscoveryInfo()`.
- `admins` entries that are not strings shaped like a Matrix user ID are ignored.
- An empty or missing list means "not configured" (download fallback).
- Components read the list through `useBugReportAdmins()`, which follows the discovery info instead of caching it at mount, because the well-known fetch may still be in flight at mount.

## Report room

- Created by the reporter with `preset: private_chat`, `visibility: private`, `invite: admins` (excluding the reporter), and `creation_content.type = "io.mindroom.bug_reports"`.
- Named `Bug reports · <reporter display name>`.
- Created without `m.room.encryption` so `matrix-mcp` (no E2EE support) can read it.
  If the homeserver encrypts it anyway, sending still works: the JSON is encrypted with the existing `encryptFile` helper and sent as `file` instead of `url`.
- The room ID is stored in user account data `io.mindroom.bug_reports` as `{ "room_id": "!…" }`.
- On each report the stored room is reused only while it is still a private report room for the current administrators: its create type is `io.mindroom.bug_reports`, the reporter is joined, the join rule is `invite`, history visibility is not `world_readable`, and every other joined or invited member is a current administrator (members are loaded first).
  Otherwise a new room is created and the account data is replaced; nobody is kicked and the old room is not left.
- Administrators who are neither joined nor invited are invited again with `Promise.allSettled`; the report fails only when no administrator is in the room and none can be invited.
- Concurrent reports from the same client share one in-flight room lookup, so double clicks never create two rooms.

## Report message

The thread root is an `m.text` message with an English body (Matrix content is never translated):

```text
Bug report from Alice (@alice:company.com)
Message: <permalink to the reported event>
Thread: <permalink to the thread root>   (only when the message is in a thread)
Room: <room name>
Client: MindRoom Chat <build> (<web|ios|android>)
The debug data is attached below. Add any details in this thread.
```

Its content also carries a machine-readable key so tools can parse it without downloading the file:

```json
"io.mindroom.bug_report": { "version": 1, "room_id": "!…", "thread_id": "$…", "event_id": "$…" }
```

The JSON file (compact, no indentation) is sent as an `m.file` reply in that thread, named `mindroom-bug-report-<ISO timestamp>.json` with `application/json`.
It is uploaded before the summary root is sent, so a failed upload leaves nothing in the report room.

## Report JSON (version 1)

```jsonc
{
  "type": "io.mindroom.bug_report",
  "version": 1,
  "reportedAt": "2026-10-03T12:00:00.000Z",
  "reporter": {
    "userId": "@alice:company.com",
    "deviceId": "ABC",
    "homeserver": "https://matrix.company.com"
  },
  "target": {
    "roomId": "!r:company.com",
    "roomName": "Lobby",
    "threadId": "$root", // null when the message is not in a thread
    "eventId": "$selected", // may be a local echo ID such as "~!r:…"
    "permalink": "https://…"
  },
  "events": [
    // thread root + newest 200 replies, or the main-timeline tail
    {
      "eventId": "$e",
      "status": null, // MatrixEvent.status: null when confirmed, else sending/not_sent/…
      "decryptionFailure": false,
      "event": {
        /* getEffectiveEvent() with its original decrypted content (and wire m.relates_to), incl. io.mindroom.ai_run, tool_trace, stream_status */
      },
      "latestEdit": {
        /* replacingEvent()?.getEffectiveEvent(), or null */
      }
    }
  ],
  "omittedEventCount": 0, // thread replies held but left out by the 200-reply bound
  "client": {
    "build": "…",
    "platform": "web|ios|android",
    "userAgent": "…",
    "language": "en",
    "timeZone": "Europe/Amsterdam",
    "viewport": { "width": 390, "height": 844, "devicePixelRatio": 3 },
    "online": true,
    "visibility": "visible",
    "syncState": "SYNCING",
    "location": "https://chat…/home/!r…?threadId=$root"
  },
  "diagnostics": {
    /* exactly the payload of the existing diagnostics export */
  }
}
```

- **Thread scope:** when the selected event has `threadRootId`, `events` is the root plus the newest 200 replies the client holds (`room.getThread(id)?.events` merged with the live timeline through `getThreadReplyEventsForRoot`, sorted by timestamp), or the 200 ending at the selected reply when it is older; `omittedEventCount` counts the held replies left out.
- **Main timeline scope:** otherwise `events` is the last 50 events up to and including the selected event, taken from the timeline that holds it (`room.getTimelineForEvent(id)`, falling back to the live timeline); `omittedEventCount` is 0.
- `m.replace` edit events are left out of `events` (except a selected edit), and each event carries only its latest edit; streaming responses can produce hundreds of edits and the latest one is what the reporter saw.
- `diagnostics` is `buildDiagnosticsPayload()`, split out of `buildDiagnosticsExport()` so the payload object can be built without serialising it to a Blob.

## Components

All new code lives in `src/app/mindroom/bug-reports/`, per the fork's file-boundary policy.

| Unit                           | Responsibility                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `bugReportConfig.ts`           | Parse `io.mindroom.bug_reports.admins` from the well-known info; `useBugReportAdmins()` for components |
| `bugReportPayload.ts`          | Build the report JSON from client, room, and event                                                     |
| `bugReportRoom.ts`             | Find, validate, or create the reporter's report room; account data; in-flight dedupe                   |
| `sendBugReport.ts`             | Send the summary root and the JSON file in its thread; return `{ roomId, threadRootId }`               |
| `MessageBugReportItem.tsx`     | Menu item: send or download, sending and error states, navigation on success                           |
| `BugReportAutoJoinFeature.tsx` | Administrator-side auto-join, mounted in `MindroomClientNonUIFeatures`                                 |

Upstream-facing changes are limited to rendering `MessageBugReportItem` in `MindroomMessage.tsx` (already a fork file) and splitting `diagnosticsExport.ts`.

## Auto-join rules

The administrator's client joins an invited room only when all of these hold:

1. The current user is in the well-known `admins` list.
2. The invite's stripped `m.room.create` content has `type: "io.mindroom.bug_reports"`.
3. The invite's stripped `m.room.join_rules` content has `join_rule: "invite"`; a missing join rule does not qualify.
4. The sender of the stripped `m.room.create` event is the inviter, so an inviter cannot pull the administrator into a room someone else created.
5. The inviter is on the administrator's own homeserver (same server name), so a remote server cannot use auto-join to push rooms onto the administrator.

Each room is attempted once per session; a failed join is logged and left as a normal invite.

## Error handling

- Room creation, invites, uploads, and sends surface as one error state on the menu item; details go to `console.warn`.
- A failed send after room creation keeps the account data, so the retry reuses the room.
- Waiting for a newly created room to appear in the client uses `waitForJoinedRoom` from `src/app/mindroom/matrix/waitForJoinedRoom.ts` (15 s timeout).

## Testing

- Unit tests (Vitest, colocated): config parsing; payload scopes, edits, local echo status, and diagnostics inclusion; room reuse, stale-room replacement, re-inviting admins, and in-flight dedupe; root and file content including the encrypted-room branch; auto-join gating on admin, room type, join rule, room creator, and inviter server; menu item labels and states.
- `npm run typecheck`, `npm run lint`, `npm run build`, and the i18n coverage test.
- Live check against a local homeserver with two accounts, the reporter and the administrator, with `io.mindroom.bug_reports` in the client well-known.

## Out of scope

- A description dialog; context is typed into the report thread instead.
- Backend replies or triage agents in report rooms.
- Composer auto-focus after navigation.
- Screenshots.
- Configuring the well-known on existing deployments (an operator task).
