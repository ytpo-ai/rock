---
description: "The OpenCode v2 subagent backend for users and maintainers choosing a delegation provider, configuring a local OpenCode server, or debugging local nested child runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-opencode

English | [中文](README.zh.md)

## Summary

`dsh-subagent-opencode` runs each delegated task in one session on the local OpenCode v2 server. The provider discovers the server from its service file (or an explicit url/password), authenticates with HTTP Basic, creates a session in the parent workspace, dispatches the text-only task, and polls the durable message list until the idle message settles the turn. It never spawns or stops the OpenCode server, and the session stays on the server so the OpenCode UI can list and resume it. Choose this backend when delegation should run on a separately installed OpenCode desktop server rather than in a Harness-managed process.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

Choose this backend when the child must be a full OpenCode session on a separately installed OpenCode v2 server — its own model, tools, and durable transcript visible in the OpenCode UI — rather than a Harness-managed process or in-process agent. The provider advertises no start-time capabilities (`agentOptions`/`agentPreset`/`outputSchema`/`depthLimit` are false) and `inheritsParentContext: false`. A parent that requests an unsupported capability is rejected at start rather than having it silently ignored.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `opencode` | Registry name on `ctx.subagents` |
| `servicePath` | `~/.local/state/opencode/service.json` | Discovery file carrying `url` and `password` |
| `url` | — | Explicit server URL; requires `password`, and overrides `servicePath` |
| `password` | — | Explicit server password; requires `url`, and overrides `servicePath` |
| `agent` | — | OpenCode agent id fixed for created sessions |
| `pollIntervalMs` | `500` | Delay between durable-message polls |

Discovery reads the OpenCode service file (`~/.local/state/opencode/service.json`) for the server URL and password, then sends `Authorization: Basic base64("opencode:" + password)` on every request. When both `url` and `password` are set, discovery is skipped and those values are used instead. A missing or unreadable service file, or a missing credential, fails the run at start.

```yaml
- id: subagent-opencode
  name: '@deepseek-ai/dsh-subagent-opencode'
  config:
    providerName: opencode
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config: { provider: opencode, toolName: subagent, maxDepth: 'provider-managed' }
```

### What you get

A successful run returns the child's final assistant text as result output. The turn's idle outcome maps into the seam vocabulary: `succeeded` becomes `completed` (with `length` finish mapped to `max-tokens` and `content-filter` to `refusal`), `failed` becomes `error` with a safe diagnostic, and `interrupted` becomes `error`. An `aborted` result stays aborted when the parent cancels.

### Failure and recovery

Discovery failures (missing service file or credentials) and working-directory failures reject before publication. A `401`/`403` response maps to an `auth` category, a network failure to `transport`, and a non-2xx to `product` with the HTTP status. Diagnostics expose only the fixed product, stage, category, and HTTP status — never response bodies, paths, task content, or credentials. Disposal interrupts the active run best-effort and never stops the OpenCode server.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, discovery, provider registration |
| [`src/run.ts`](src/run.ts) | Run lifecycle, output selection, and stop-reason mapping |
| [`src/client.ts`](src/client.ts) | REST client: discovery-file reading, Basic auth, session/prompt/message/interrupt calls |
| [`src/failure.ts`](src/failure.ts) | Fixed safe diagnostics and structured run failures |
| [`src/types.ts`](src/types.ts) | Shared wire and configuration types |

### Run flow

A start resolves the working directory, discovers the server, and builds a Basic-authorized client. It creates one session (`location` = the parent workspace, plus any configured title/agent/model/permissions), dispatches the text task, and then polls `GET /api/session/{id}/message` until the idle message appears. Output is the text parts of the last non-empty assistant message. The HTTP JSON wire is the validation boundary: malformed responses are rejected rather than trusted.

-----

<a id="model-experience"></a>
## Model Experience

### Child-agent request

#### What the model sees

The OpenCode child's model receives the standalone task as its user message plus the OpenCode server's own configured system prompt, agent, tools, and fresh session. It receives no parent conversation.

#### Token effect

The child pays for an independent full context and its own multi-step history. These tokens never enter the parent's context.

#### KV Cache effect

Independent of the parent request cache; the OpenCode server owns the child's cache and history.

### Parent tool result, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent model first receives the child's name, then a completion notice containing final or partial assistant text, the stop reason, and safe diagnostic.

#### Token effect

Parent input grows by the start acknowledgement and completion notice, whose size depends on the result data.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local server only** — discovery reads the local service file and reuses the server's root password; cross-machine delegation needs OpenCode pairing and a session token, which this provider does not implement.
- **Polling result receipt** — the provider polls the message list; it does not consume the `/api/event` SSE stream, so a very long turn settles only when the idle message is observed.
- **Permission posture is not wired yet** — the provider creates sessions with the OpenCode server's default permission posture; explicit session-level `permissions` and a fixed `model` selection are deferred until their OpenCode-side semantics are verified against the running server.
- **LLM proxy is not wired here** — routing the OpenCode child's provider `baseURL` to the Seagull gateway is a deployment-level OpenCode configuration, not a field this provider sets.
