---
description: "First-message LLM session-title provider for users and maintainers choosing a title strategy or debugging automatic title generation."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-title-first-prompt-llm

English | [中文](README.zh.md)

## Summary

`dsh-session-title-first-prompt-llm` titles a root session through `ctx.llm` as an optional `ctx.sessionTitle` provider. It registers the `first-prompt` cadence: the first eligible human message titles the session, and every third message re-titles it from the recent conversation, attributing the result to the seqs it read. An automatic failure retains the fallback; the next due refresh or an explicit `ctx.sessionTitle.refresh()` retries it. The plugin owns its system instruction, JSON framing, and output parsing; it shares only the [execution module](../session-title-llm/README.md) from `dsh-session-title-llm` with the all-prompts provider. Automatic behavior and configuration come first; the implementation is a small provider strategy over that executor.

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

Mount this plugin beside the title service when a session should be titled from its first eligible human message and re-titled as the conversation moves on. It requires its own `targetWords` and `targetCjkCharacters` plus the shared [execution controls](../session-title-llm/README.md#configuration), all with no defaults.

### When titles are generated

Automatic generation runs only for a session with no parent: after its first eligible human message the fallback is created and one auxiliary request titles the session from that message, and every third later eligible message re-titles it from the most recent messages. Explicit user renames and inherited fork history never trigger a call. An automatic failure keeps the current title until the next due refresh or an explicit `ctx.sessionTitle.refresh()`. Forks keep their inherited title and never run this provider automatically, even when their seeded first message came from the parent.

### Configuration

The plugin requires `targetWords` and `targetCjkCharacters` plus the shared [execution controls](../session-title-llm/README.md#configuration): `maxInputBytes`, `maxOutputTokens`, `timeoutMs`, and the optional paired `provider`/`model` route. Omit both to inherit the exact route from the current logged main request, or set both to route title generation independently. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-title-first-prompt-llm) is the exhaustive source for every accepted field.

### Failures and recovery

A generation that fails — a missing route before any main request, input over `maxInputBytes`, timeout, cancellation, or invalid model output — warns and keeps the current title; the next due refresh or an explicit `refresh()` retries. Automatic work adds no tokens and no latency to the main agent request.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the plugin's shape; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

A small provider strategy: it builds the system instruction and JSON input for the messages one call covers — the first message alone on initial generation, otherwise a trailing window plus the current provider title — parses the assembled response into a title, and delegates only route, bounds, cancellation, logging, and assembly to the [shared execution module](../session-title-llm/README.md).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, prompt and framing, output parsing, and direct provider registration |

### Scheduling

The title service schedules automatic work: for the `first-prompt` cadence it starts a revision on a root session's first eligible message and on every third later one; the provider call begins after the exact main-request route is logged, and a newer revision supersedes older work.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the provider contract is not enough. They move from the shared execution module to the alternative cadence and the service it plugs into.

- [Shared LLM execution module](../session-title-llm/README.md) — the execution module this provider uses.
- [All-messages title provider](../../experimental/session-title-all-prompts-llm/README.md) — the cadence that retitles after every new prompt.
- [Session title service](../session-title/README.md) — fallback behavior, rename, refresh, and provider registration.
- [Session package map](../README.md) — adjacent persistence, projection, title, and telemetry packages.

-----

<a id="model-experience"></a>
## Model Experience

### Automatic title requests

#### What the model sees

The title model receives this provider's title instruction and a JSON array of the human messages the call covers: the first eligible message alone on initial generation, otherwise the most recent ten. A refresh also receives the current provider title as `currentTitle` in a JSON object, with a stability rule to keep it while it still describes the session. Inherited fork history does not trigger another automatic call.

#### Token effect

One automatic auxiliary request titles a root session, then one per three later eligible messages, each bounded by `maxInputBytes` and `maxOutputTokens`; explicit refreshes may make additional calls. It selects the route's least supported reasoning effort, or leaves effort unspecified when the route exposes none. The main agent request gains zero tokens.

#### KV Cache effect

No main-request invalidation. The auxiliary request uses the configured or logged route and has provider-specific cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this provider stops representing the session. They are current package constraints.

- **Refresh interval is fixed** — a session is re-titled only every third later eligible message, so a topic that changes earlier keeps its previous title until the interval passes; use the all-messages provider when every prompt should retitle it.
- **Forks never retitle automatically** — a fork keeps its inherited title and never runs this provider automatically, even when its seeded first message came from the parent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
