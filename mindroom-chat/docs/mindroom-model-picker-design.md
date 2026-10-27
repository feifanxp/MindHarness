# Model picker over Matrix

Status: implemented in the runtime and MindRoom Chat.
The client controller, responsive composer picker, authenticated discovery, structured selection results, and Matrix media icons are now the final architecture described here.

## User experience

A compact row above the thread composer shows the selected model's icon and display name without reducing writing width.
Opening it reveals a searchable list grouped by provider, with a checkmark beside the current selection.
Each row shows the friendly display name above the stable configuration key and provider.
Search matches the display name, configuration key, and provider.
A separate **Use room default** row clears the thread override; a model whose key is `default` remains a distinct choice.
The picker states that selection applies to all agents and teams in the thread.
The chip shows **Room default** when no thread override exists, since inherited models can differ between agents.
The desktop picker is an anchored popover; narrow screens use a bottom sheet.
Changes affect future replies and do not interrupt an active generation or rewrite historical model badges.
A pending selection remains pending until the runtime confirms it, and changing the selection preserves the message draft.
The existing command autocomplete remains unchanged and readable `!model` commands remain available as the fallback.

The implementation supports existing threads, matching the current `!model` mutation scope.
Choosing a model before a thread's first message is a separate extension: carry the selection on that first message and persist it before model resolution and dispatch.
Sending the first message and then sending a model command would race with the first response.
Room-wide model changes remain separate and preserve the existing `!room_model` admin requirement.

## Optional model display metadata

The runtime model configuration and configuration editor support `display_name` and `icon`.
These fields describe presentation and must not be forwarded as model-provider arguments.
For an existing model entry, the proposed additions are:

```yaml
display_name: 'Claude Sonnet'
icon: './icons/claude.png'
```

| Field          | Meaning                                                                                     | Omitted or unavailable                                    |
| -------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `display_name` | Human-readable name; trim surrounding whitespace and treat blank text as absent             | Show the configuration key                                |
| `icon`         | A local image path relative to the configuration file, or a Matrix `mxc://` media reference | Use the existing provider logo, then a generic model icon |

The configuration key stays stable, so `!model sonnet` and persisted overrides keep using `sonnet` even if its display name changes.
Display names need not be unique; the secondary key distinguishes duplicates.
The runtime validates local icon images, uploads them through Matrix media, and caches successful uploads by content hash.
Discovery returns the resulting Matrix media reference, never a local filesystem path.
The client uses its existing authenticated Matrix media loader instead of fetching arbitrary external logo URLs.
Ordinary Matrix media uploads are not end-to-end encrypted; this initial design treats logos as shareable presentation assets.
Private icons would require an encrypted attachment descriptor and encrypted upload, which is outside this initial proposal.
Missing files, failed uploads, or unreadable media fall back to the provider icon without blocking model selection.
Changing display metadata changes the catalog revision.
The same presentation metadata can decorate the picker and chip; future run metadata should snapshot it for historical model badges.

## Transport choice

Use encrypted Matrix to-device requests for discovery and the existing Matrix room-command path for mutations.
Both travel through the Matrix homeserver; the client needs no direct connection to the MindRoom backend or model providers.
Matrix defines [to-device messaging](https://spec.matrix.org/v1.19/client-server-api/#send-to-device-messaging) as transient signalling delivered through `/sync`, outside shared room history.

| Approach                         | Benefit                                     | Cost                                                                                |
| -------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Encrypted to-device discovery    | Queries do not add room timeline events     | Requires runtime-device discovery, authenticated replies, timeouts, and re-querying |
| Custom room request/reply events | Reuses room delivery and access context     | Persists discovery traffic; encrypted events can match notification rules           |
| Room-state catalog               | Available with room state and easy to cache | Ordinary state lacks message encryption and needs state-write permissions           |

Hiding a custom room event in Chat does not suppress homeserver notifications for encrypted traffic.
See Matrix's [default push rules](https://spec.matrix.org/v1.19/client-server-api/#default-underride-rules).
To-device signalling does not grant room access and is not a substitute for backend authorization.

## Discovery exchange

Use namespaced event types `io.mindroom.models.request` and `io.mindroom.models.response`, both inside encrypted to-device messages.

1. Identify joined runtime-router candidates through the viewer-scoped Matrix agent identity rules, then authenticate active devices through owner-signed Matrix device keys.
   A catalog qualifies only when it also names a separate joined actual agent for the room.
   A username prefix or self-declared payload is insufficient; bind the reply to the authenticated sender and apply the client's Matrix device-trust policy.
   When multiple runtimes are present, select an explicit runtime and keep their catalogs separate.
2. The client installs a response listener before sending a versioned request with `request_id`, `room_id`, and optional `thread_id`.
   Resolve the router device using Matrix device keys; do not add a separate device-discovery service.
3. The router authenticates the sending device and checks current room membership and responder access.
   A supplied thread must belong to the supplied room.
   Reply only to the authenticated requesting device.
4. Return `version`, `request_id`, matching scope, `catalog_revision`, configured model entries, the current thread override, and inherited model information.
   Allowlist model entry fields: `key`, `display_name`, `provider`, `id`, and optional `icon_url`.
   An `icon_url` is a Matrix media reference.
   The catalog lists configured models; it does not promise that provider credentials, billing, or model availability are healthy.
5. Accept replies only from the expected runtime/device and only for the matching request, room, and thread.
   Render cached eligibility while refreshing and offer retry after timeout.
   Bound request lifetimes and response sizes; discard late responses after navigation or request expiry.

Cache catalogs by runtime identity and room, with thread selection stored separately.
Refresh on picker opening and after configuration changes; a revision is meaningful only within its owning runtime.
To-device messages are not a shared durable state store, so another client obtains a fresh view when it opens the picker.
An unsupported or offline runtime leaves the existing `!model` command available; do not parse prose responses into a catalog.
Validate unknown protocol versions and malformed payloads before changing UI state.

## Applying a selection

Send a normal Matrix thread command and reuse the existing authorization, persistence, and command-result delivery path.
The command remains readable in other clients.
Add structured command metadata carrying the target runtime and an explicit `set` or `reset` operation.
A `set` carries the stable model key; a `reset` carries no model key.
This distinguishes the operation from configured models named `reset`, `list`, or `default`.
The runtime validates the structured operation, model existence, room/thread scope, and sender access before applying it.
The target runtime identifier routes the command; it does not confer authority.
Deduplicate retries through the existing command event identity and serialize model mutations for the same thread.
The backend reply includes structured result metadata correlated to the command event and the confirmed selection.
Before updating a chip, validate the expected runtime sender and the room's Matrix trust/encryption requirements, the room and thread scope, and the referenced command's target runtime and operation.
In encrypted rooms, validate the sending device through the Matrix encryption metadata; content that merely claims a runtime identity is insufficient.
Ignore forged, mismatched, duplicate, or older results so a delayed acknowledgement cannot overwrite a newer confirmed selection.
Only the current client's own pending command consumes its matching acknowledgement.
External changes and readable command results appear after refresh instead of globally changing every open picker.
Rejected commands, removed models, permission changes, and timeouts must not appear as successful selection.
Successfully storing an override does not guarantee provider health.
A queued SDK send is not a runtime acknowledgement.

## Implementation boundaries and validation

Runtime work includes the optional configuration fields, editor support, icon upload/cache, authenticated discovery handler, and structured command/result metadata.
Client work includes one client-scoped controller for discovery and commands, scoped caching, Matrix media rendering, and the shared picker.
The `useModelPicker` hook exposes controller snapshots and actions while the presentation sends no Matrix traffic itself.
Only existing thread composers subscribe, and the authenticated controller snapshot decides whether the compact row renders.
Desktop uses an anchored Folds pop-out and mobile uses a safe-area-aware bottom sheet.
Search, listbox keyboard navigation, provider grouping, runtime choice, pending recovery, and focus restoration stay inside the presentation layer.
Dismissal never cancels a pending command, and a later acknowledgement closes or restores focus only while the same picker remains open.
Reuse existing model override persistence and provider-logo rendering.
No implementation should require direct client HTTP requests to the runtime.

Before release, validate:

- Interoperability between the actual client SDK and runtime's encrypted to-device transport.
- Device-key rotation, untrusted devices, wrong senders, wrong request IDs, room membership loss, and multiple runtimes.
- Catalog refresh, stale data, reconnects, old backends, removed model keys, duplicate display names, and malformed metadata.
- Set/reset semantics, duplicate deliveries, refresh-based external updates, and unchanged room-admin rules.
- Matrix-only icon loading, missing custom icons, and built-in fallbacks.
- Keyboard use, mobile layout, pending/error feedback, and draft preservation.
- Existing commands remain usable in other Matrix clients.

Focused controller, component, composer, and live Matrix checks verify protocol ownership, authorization gates, selection persistence, keyboard behavior, responsive layout, draft preservation, and icon fallback.
