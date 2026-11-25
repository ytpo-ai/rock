/**
 * Transport-level liveness probes for the tools that Rock delegates to through
 * a resident service/daemon. A probe reports `true` when the transport accepts
 * a connection (unix socket connect) or an HTTP server responds (any status),
 * and `false` for a network/socket error, a timeout, or a tool without a
 * resident service. Probes are best-effort and never throw.
 *
 * @module @rock/rock-tool-inventory/service-probe
 */
import { connect } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ToolConnectionConfig } from './types.ts'

/** Default Codex daemon control socket, relative to the Codex home. */
const CODEX_SOCKET_REL = 'app-server-control/app-server-control.sock'

/** OpenCode service discovery file, relative to the user home. */
const OPENCODE_SERVICE_REL = join('.local', 'state', 'opencode', 'service.json')

/** Default DSH web Host Remote API base URL. */
const DEFAULT_DSH_URL = 'http://127.0.0.1:3080'

/** Injectables for a probe: replace the OS/network boundaries in tests. */
export interface ServiceProbeDeps {
  /** Establish a unix socket connection, resolving on connect and rejecting on error/timeout. */
  connectSocket?: (path: string, timeoutMs: number) => Promise<void>
  /** Fetch-like transport for HTTP liveness; any resolved response means "up". */
  fetch?: typeof fetch
  /** Home directory base (defaults to `homedir()`). */
  homeDir?: () => string
  /** Environment (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv
  /** File existence check for the OpenCode discovery file (defaults to `existsSync`). */
  existsFile?: (path: string) => boolean
  /** File read for the OpenCode discovery file (defaults to `readFileSync`). */
  readFile?: (path: string) => string
}

/**
 * Probe one tool's resident service at the transport level. Returns `true` when
 * the transport is reachable, `false` otherwise (including unknown tools with
 * no resident service). Never throws.
 * @param toolId - the tool type id (`codex` / `opencode` / `dsh`).
 * @param connection - the persisted service connection (url/token overrides).
 * @param timeoutMs - per-probe timeout.
 * @param deps - injectable OS/network boundaries for tests.
 */
export async function probeServiceLiveness(
  toolId: string,
  connection: ToolConnectionConfig | undefined,
  timeoutMs: number,
  deps: ServiceProbeDeps = {},
): Promise<boolean> {
  switch (toolId) {
    case 'codex': {
      const path = codexSocketPath(connection, deps)
      return path === undefined ? false : probeSocket(path, timeoutMs, deps)
    }
    case 'opencode': {
      const target = opencodeUrl(connection, deps)
      return target === undefined ? false : probeHttp(target, timeoutMs, deps)
    }
    case 'dsh':
      return probeHttp(dshUrl(connection, deps), timeoutMs, deps)
    default:
      return false
  }
}

/** Resolve the Codex daemon socket path: explicit url wins, else `CODEX_HOME` / `~/.codex`. */
function codexSocketPath(connection: ToolConnectionConfig | undefined, deps: ServiceProbeDeps): string | undefined {
  if (connection?.url !== undefined && connection.url.length > 0) return connection.url
  const env = deps.env ?? process.env
  const codHome = env.CODEX_HOME
  const base = codHome !== undefined && codHome !== ''
    ? codHome
    : join((deps.homeDir ?? homedir)(), '.codex')
  return join(base, CODEX_SOCKET_REL)
}

/** Resolve the OpenCode server URL: explicit url wins, else the discovery file. */
function opencodeUrl(connection: ToolConnectionConfig | undefined, deps: ServiceProbeDeps): string | undefined {
  if (connection?.url !== undefined && connection.url.length > 0) return connection.url
  const servicePath = join((deps.homeDir ?? homedir)(), OPENCODE_SERVICE_REL)
  if (!(deps.existsFile ?? existsSync)(servicePath)) return undefined
  try {
    const read = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
    const record: unknown = JSON.parse(read(servicePath))
    const url = (record as { url?: unknown } | null)?.url
    return typeof url === 'string' && url.length > 0 ? url : undefined
  } catch {
    return undefined
  }
}

/** Resolve the DSH Remote API URL: explicit url wins, else the env var or default. */
function dshUrl(connection: ToolConnectionConfig | undefined, deps: ServiceProbeDeps): string {
  if (connection?.url !== undefined && connection.url.length > 0) return connection.url
  const env = deps.env ?? process.env
  const url = env.ROCK_DSH_REMOTE_URL
  return url !== undefined && url !== '' ? url : DEFAULT_DSH_URL
}

/** Probe a unix socket: resolve on connect, reject on error/timeout (best-effort). */
async function probeSocket(path: string, timeoutMs: number, deps: ServiceProbeDeps): Promise<boolean> {
  const connectSocket = deps.connectSocket ?? defaultConnectSocket
  try {
    await connectSocket(path, timeoutMs)
    return true
  } catch {
    return false
  }
}

/** Probe an HTTP server: any resolved response means "up"; error/timeout means "down". */
async function probeHttp(url: string, timeoutMs: number, deps: ServiceProbeDeps): Promise<boolean> {
  const fetchFn = deps.fetch ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    await fetchFn(url, { method: 'GET', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Default unix socket connect: resolve on connect, reject on error or timeout. */
function defaultConnectSocket(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('socket connect timeout'))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve()
    })
    socket.once('error', (error: Error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    })
  })
}
