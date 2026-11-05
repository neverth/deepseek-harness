---
description: "Client Session status table and useSessionStatus hook: running state, the effective pending interaction, persistent completion reminders, and shared manual reading marks."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-status

English | [中文](README.zh.md)

## Summary

Show each Session's running state, highest-precedence pending interaction, and completion reminder from one Client status table. Observed completion reminders persist in browser storage across page reloads and Host restarts until explicit confirmation or the next run. Connected clients share manual reading marks through Host memory. Reading marks do not change conversation history or model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle's single `ui-session-status` row loads both faces: the Host reading service `ctx.sessionStatus` and, after [`dsh-client-ui-session`](../ui-session/README.md), the Client plugin, which the Web client requires at startup. A composition without this package has no status table and no `useSessionStatus` hook, and profiles without the Web bundle run no reading service. The package has no configuration fields. Browser completion reminders use the `dsh.session-completion-unread.v1` and `dsh.session-completion-pending-ack.v1` local storage keys; Host reading records are held in memory.

Use the Session row menu to **Mark as read** or **Mark as unread**. All clients connected to that Host share manual marks; a failed operation leaves the previous reminder visible and reports failure. An observed running-to-idle transition creates an unread completion reminder. Opening its main view changes that reminder to pending confirmation, displayed in yellow by the workspace browser. Explicit confirmation clears it; focus, view switches, page reloads, and Host restarts preserve it. A new run clears both completion reminder states. Existing history starts read unless a stored reminder or manual mark applies. Unread reminders do not imply task success and remain independent of running and pending-interaction status.

Components read the status table through the `useSessionStatus` root hook. A Client plugin that reads `ctx.uiSession.sessionStatus` adds `'uiSession'` and `'uiSession.sessionStatus'` to its `inject` list; without them, Cordis rejects the property read. A plugin whose components call `useSessionStatus` injects `'uiSession.sessionStatus'` as well, so the plugin unloads and reloads with the hook. The member is declared on ui-session's `UiSessionService`, the type of `ctx.uiSession`; a value annotated as the `UiSession` class does not show it.

| Member | Use |
|---|---|
| `getSnapshot()` / `subscribe(listener)` | Status by Session identity; the snapshot keeps its reference until a status fact changes, and a throwing listener is reported without stopping later listeners |
| `mark(sessionId, unread)` | Mark a Session read or unread; rejects while reading is not synchronized or when the Host rejects the mark |
| `acknowledgeCompletion(sessionId)` | Explicitly clear an observed completion reminder; a manual unread mark requires a confirmed Host write |
| `readingReady` | Whether the current Host reading baseline has arrived |

Each `SessionStatus` has five fields:

| Field | Source |
|---|---|
| `running` | Host Session list baselines and `api-session/status` events; absent until either establishes it. Subagent catalog rows and retained subagent fallback rows do not establish it. |
| `pendingInteraction` | The same object `ctx.uiSession.pendingInteractions` publishes for that Session. Domain plugins register requests through `ctx.uiSession.registerPendingInteraction(precedence)`. |
| `completionUnread` | A locally observed completion has not been opened in the main view, or the Host reading record carries a manual unread mark |
| `completionPendingAck` | The main view opened an observed completion whose reminder still needs explicit confirmation |
| `completionFailed` | The Session is unread and its latest completed turn ended with an execution error this Host observed |

The Host face serves the `sessionStatus` Remote namespace with `mark` and `follow`; its failures use `session-status/not-found` and `session-status/unavailable`. The Client keeps its copy of the reading records private: no Client service other than `ctx.uiSession.sessionStatus` exposes them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Reading records live in the Host service's Map and change only from `turn/end` events and explicit marks. Each record holds `completedTurn`, `failed`, `readTurn`, and `manualUnread`. Marks do not change execution facts or flush the Session log.

The Client submits the completed turn it has seen. The Host advances `readTurn` monotonically up to that position, bounded by its known completion; automatic acknowledgements preserve `manualUnread`. Explicit read and unread actions clear or set that flag in Host processing order. Cold menu actions check metadata without opening history.

Only the ordered subscription updates Client records; mutation replies report success or failure. Streams send an accessible baseline followed by whole-record changes. The Client follows them through `ctx.remote.$stream` and the Gateway's `RemoteSnapshotStream` only while `ctx.remoteAccess` allows `sessionStatus/follow`, so a LiveShare viewer opens no stream and keeps `readingReady` false; a normal stream end returns an error with the Gateway's `gateway/carrier-lost` code, so the stream reconnects and the next baseline replaces the records. The existing access stream ends a reading generation when grants change, so reconnecting clients receive a fresh baseline. Disposal closes followers and discards records; pending metadata lookups cannot commit afterward.

The Client plugin combines Session list baselines, `api-session/status` events, ui-session's pending interactions, local completion reminders, and Host manual marks into the status table, provided as `uiSession.sessionStatus` beneath `ctx.uiSession`. Main-view retention moves a local unread reminder to pending confirmation. The Client installs no automatic reading acknowledgement. A ready catalog removes local reminders for absent Session identities.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session reading memory decision](../../../.agents/notes/implemented/feature/2026-10-23-session-reading-memory.md) — package structure, Host memory ownership, concurrency, and deferred persistence.
- [Session UI adapter](../ui-session/README.md) — the parent `ctx.uiSession` service and pending-interaction registration.
- [Workspace browser](../ui-workspace/README.md) — row menu and reminders.

-----

<a id="model-experience"></a>
## Model Experience

None, as reading records and the status table add no tools, prompts, or Session events.

#### KV Cache effect

None; reading marks and the status table do not assemble model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Reading state has these operational limits:

- **Concurrent explicit marks** — the last action processed by the Host wins. Delayed explicit read actions can clear a newer manual unread mark; there is no revision comparison.
- **One Host process** — separate Host processes or machines do not synchronize with each other.
- **Host restart or plugin reload** — Host reading records reset, including manual marks and failure metadata; local completion reminders remain. A turn that failed before the restart keeps no outcome, so its reminder shows the ordinary completion state. Reloading the Host plugin ends every reading stream; if the replacement service is not yet serving when the Client reconnects, the Client receives a terminal error, disables reading commands, and recovers only after a page reload.
- **Browser storage and offline completion** — blocked or full storage keeps reminders only in memory. Local completion reminders are browser-specific and require an observed running-to-idle transition; a completion while the browser is disconnected does not establish a local reminder.
- **Web profiles only** — the row lives in the Web bundle, so profiles without it run no reading service.
- **Metadata and transport failures** — a failed metadata lookup leaves reading state unchanged. A terminal stream or protocol failure disables reading commands until the page reloads; ordinary carrier loss reconnects automatically.
- **Unloaded and archived Sessions** — records for Sessions unloaded from memory remain until the service stops; reclaiming them requires a Session deletion lifecycle. Archived rows hide their unread styling and status, read as read, and offer no reading mark in the row menu or shortcut.
- **No message counts or read receipts for other people** — the state belongs to the Host's owner and records Session-level reminders. LiveShare viewers cannot read or change it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
