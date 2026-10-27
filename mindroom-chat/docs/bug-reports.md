# Bug reports

Every message menu has **Report a bug**.
One click sends a JSON report to the deployment's administrators and opens the report thread, where the reporter can add details.
State events (the room-event menu) do not show the item.

## Enable it

Add the administrators to the homeserver's `/.well-known/matrix/client`:

```json
{
  "m.homeserver": { "base_url": "https://matrix.example.com" },
  "io.mindroom.bug_reports": { "admins": ["@admin:example.com"] }
}
```

The document must be served with `Access-Control-Allow-Origin: *`, as Matrix clients already require.
The menu item is labelled **Download bug report** and saves the JSON instead when the key is missing, when the `admins` list is empty or holds no valid Matrix user IDs, and while the client is still loading the well-known.

## What happens

- The reporter gets one private room, `Bug reports · <name>`, shared only with the administrators; each report is a thread in it.
- The room has type `io.mindroom.bug_reports` and is created unencrypted so `matrix-mcp` can read it.
  Reports from encrypted rooms are therefore stored decrypted in this unencrypted room.
- The room ID is kept in the reporter's account data `io.mindroom.bug_reports`.
- Each report reuses that room only while the reporter is still joined, its create type is still `io.mindroom.bug_reports`, its join rule is still `invite`, its history is not `world_readable`, and every other joined or invited member is a current administrator.
  Otherwise the report goes to a new room and the account data is replaced; nobody is removed from the old room.
- Administrators who are neither joined nor invited are invited again; the report fails only when no administrator is in the room and none can be invited.
- Removing an administrator from the list moves the reporters' future reports to new rooms, but does not revoke the reports that administrator already received.

### Auto-join

An administrator's client joins report-room invites without a prompt when:

- the administrator is listed in the well-known of their own homeserver (each client reads only its own homeserver's well-known),
- the administrator uses MindRoom Chat (an offline administrator's client joins when it next syncs), and
- the invite shows an invite-only report room that the inviter created, and the inviter is on the administrator's homeserver.

Bot and `matrix-mcp` accounts do not run MindRoom Chat, so they must accept the invite themselves.

## What a report contains

- The room, thread, and message IDs, and a permalink to the message.
- The events around the message, each with its original content, its latest edit as `latestEdit`, and its local send status:
  - in a thread, the root plus the newest 200 replies this client holds, or the 200 replies ending at the message when it is older than those; `omittedEventCount` counts the replies left out;
  - otherwise the 50 main-timeline events up to the message (`omittedEventCount` is 0).
- Client build, platform, browser, viewport, sync state, and URL.
- The same diagnostics as **Settings → About → Export diagnostics**.

`m.replace` edit events are not listed in `events`, because streaming responses produce hundreds of them; each event carries its latest edit as `latestEdit` instead.
Reactions are kept.

Nothing is redacted: administrators are trusted with everything, and users never see each other's reports.

## Backend data

Run `mindroom debug-report <report.json>` on the MindRoom host to collect the backend side (turn records, Agno runs, tool calls, LLM request logs, and log lines) for the same identifiers.
