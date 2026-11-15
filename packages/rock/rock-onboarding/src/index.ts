/**
 * Rock onboarding plugin: first-run connector-key entry. Persists the employee
 * connector key locally and exposes the resolve/add-key surface as a Remote.
 *
 * ```yaml
 * - id: rock-onboarding
 *   name: '@rock/rock-onboarding'
 *   config:
 *     keyPath: .rock/connector-key.json
 *     resolveUrl: http://127.0.0.1:3000/v1/connectors/clients/resolve
 * ```
 *
 * @module @rock/rock-onboarding
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ConnectorKeyService } from './service.ts'
import type { ConnectorIdentity } from './types.ts'

export type * from './types.ts'

const DEFAULT_KEY_PATH = '.rock/connector-key.json'
const DEFAULT_RESOLVE_URL = 'http://127.0.0.1:3000/v1/connectors/clients/resolve'

/** Deployment-owned identity facts; every field is patchable from cordis.yml. */
export interface Config {
  /** Local JSON file persisting the connector key record. */
  keyPath?: string
  /** Seagull endpoint that resolves a raw key to an employee identity. */
  resolveUrl?: string
}

/** Remote service carrying the connector-key state. */
export default class RockOnboardingController extends TypertRemoteService {
  static inject = []
  static Config: z<Config> = z.object({
    keyPath: z.string().min(1).default(DEFAULT_KEY_PATH),
    resolveUrl: z.string().min(1).default(DEFAULT_RESOLVE_URL),
  })

  private readonly service: ConnectorKeyService

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockOnboarding')
    this.service = new ConnectorKeyService({
      keyPath: config.keyPath ?? DEFAULT_KEY_PATH,
      resolve: key => resolveKey(key, config.resolveUrl ?? DEFAULT_RESOLVE_URL),
    })
    void this.service.load()
  }

  /** Whether a connector key has been added locally. */
  @Remote
  hasKey(): boolean {
    return this.service.getRecord() !== null
  }

  /** The resolved identity, or null when no key has been added. */
  @Remote
  getIdentity(): ConnectorIdentity | null {
    return this.service.getIdentity()
  }

  /** Validate and persist a pasted key; fails with `rockOnboarding/invalid`. */
  @Remote
  async addKey(key: string): Promise<ConnectorIdentity> {
    try {
      return await this.service.addKey(key)
    } catch (error) {
      throw new RemoteError('rockOnboarding/invalid', error instanceof Error ? error.message : 'invalid key', {})
    }
  }
}

/** Resolve a raw key through the Seagull resolve endpoint. */
async function resolveKey(key: string, url: string): Promise<ConnectorIdentity | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    if (!response.ok) return null
    const body = await response.json() as { ok?: boolean; clientId?: string; employeeId?: string }
    if (!body.ok || !body.clientId || !body.employeeId) return null
    return { clientId: body.clientId, employeeId: body.employeeId }
  } catch {
    return null
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'rockOnboarding/invalid': Record<string, never>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The connector-key onboarding Remote. */
    rockOnboarding: RockOnboardingController
  }
}
