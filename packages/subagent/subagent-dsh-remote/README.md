---
description: "The dsh web Remote API subagent backend for users and maintainers choosing a delegation provider, configuring a running dsh web Host, or debugging local nested child runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-dsh-remote

English | [中文](README.zh.md)

## Summary

`dsh-subagent-dsh-remote` runs each delegated task in one session on a separately running `dsh web` Host. The provider connects with the Host's launch token (exchanged for a signed cookie), creates a session in the parent workspace, dispatches the text-only task, and polls `session/wait` until the turn reaches a stopping state. It never spawns or stops the Host, and the session stays on the shared Host so the dsh Web GUI can see it. Choose this backend when delegation should run as a full Harness session on a persistent Host rather than a Harness-managed subprocess.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

Choose this backend when the child must be a full Harness session on a separately running `dsh web` Host — its own preset, model, tools, and durable transcript visible in the dsh Web GUI — rather than a Harness-managed process. The provider advertises no start-time capabilities (`agentOptions`/`agentPreset`/`outputSchema`/`depthLimit` are false) and `inheritsParentContext: false`. A parent that requests an unsupported capability is rejected at start.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `dsh-remote` | Registry name on `ctx.subagents` |
| `baseUrl` | `http://127.0.0.1:3080` | `dsh web` Host base URL without a trailing slash |
| `token` | — | Host launch token (printed in the Host startup URL) |
| `agentPreset` | — | Child preset id fixed for created sessions |
| `waitTimeoutMs` | `30000` | Per-poll `session/wait` deadline |

The launch token is only printed to the Host's stdout startup URL (`dsh web: http://127.0.0.1:3080/?token=...`); pass it here through the deployment environment. A missing or invalid token fails the run at start with an `auth` diagnostic.

```yaml
- id: subagent-dsh-remote
  name: '@deepseek-ai/dsh-subagent-dsh-remote'
  config:
    providerName: dsh-remote
    baseUrl: http://127.0.0.1:3080
    token: !!js process.env.ROCK_DSH_REMOTE_TOKEN
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config: { provider: dsh-remote, toolName: subagent, maxDepth: 'provider-managed' }
```

### What you get

A successful run returns the child's final assistant text as result output. The `session/wait` stopping condition maps into the seam vocabulary: `idle` becomes `completed`, and `input-required` becomes `error` with a safe diagnostic. An `aborted` result stays aborted when the parent cancels.

### Failure and recovery

Working-directory failures, a missing token, and connect/auth failures reject before publication. A non-2xx connect maps to `auth`, a network failure to `transport`, and a Remote error code to `gateway`. Diagnostics expose only the fixed product, stage, category, HTTP status, and Remote code — never error messages, paths, task content, or credentials. Disposal cancels the active turn best-effort and never stops the Host.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, connect, provider registration |
| [`src/run.ts`](src/run.ts) | Run lifecycle and stopping-condition mapping |
| [`src/client.ts`](src/client.ts) | Typert unary client: token→cookie, envelope, session calls, output extraction |
| [`src/failure.ts`](src/failure.ts) | Fixed safe diagnostics and structured run failures |
| [`src/types.ts`](src/types.ts) | Shared wire and configuration types |

### Run flow

A start resolves the working directory, exchanges the launch token for a signed cookie, and connects the Host over the Typert unary protocol. It creates one session (`cwd` = the parent workspace, plus any configured preset), dispatches the text task, then polls `session/wait` until the stopping condition is `idle` or `input-required`. Output is the text parts of the newest non-empty committed `assistant/message` event. The HTTP JSON wire is the validation boundary: malformed envelopes or responses are rejected rather than trusted.

-----

<a id="model-experience"></a>
## Model Experience

### Child-agent request

#### What the model sees

The dsh web child's model receives the standalone task as its user message plus the Host's own configured preset, system prompt, tools, and fresh session. It receives no parent conversation.

#### Token effect

The child pays for an independent full context and its own multi-step history. These tokens never enter the parent's context.

#### KV Cache effect

Independent of the parent request cache; the Host owns the child's cache and history.

### Parent tool result, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent model first receives the child's name, then a completion notice containing final or partial assistant text, the stop reason, and safe diagnostic.

#### Token effect

Parent input grows by the start acknowledgement and completion notice, whose size depends on the result data.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Launch token from stdout only** — the Host exposes its token solely through the startup URL, so the deployment must capture that URL and pass the token via environment; there is no file or CLI exit.
- **Unary result receipt** — the provider polls `session/wait`; it does not consume the `session/follow` WebSocket stream, and the model-level stop reason (`max-tokens` versus `completed`) is not distinguished from the session-level `idle` condition.
- **Interactive input is unanswered** — the provider connects with `interactions=none` and maps an `input-required` wait to `error`; a child whose preset requests interactive approval blocks rather than auto-approving.
- **No session teardown endpoint** — the Remote API has no dispose/close, so disposal only cancels the turn and leaves the session resident on the shared Host.
