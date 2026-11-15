/**
 * Rock onboarding plugin: first-run connector-key entry. Persists the Seagull
 * base URL and employee connector key locally and exposes the resolve/add-key
 * surface as a Remote.
 *
 * ```yaml
 * - id: rock-onboarding
 *   name: '@rock/rock-onboarding'
 *   config:
 *     keyPath: .rock/connector-key.json
 * ```
 *
 * @module @rock/rock-onboarding
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ConnectorKeyService } from './service.ts'
import type { ConnectorIdentity, ConnectorKeyRecord } from './types.ts'

export type * from './types.ts'

const DEFAULT_KEY_PATH = '.rock/connector-key.json'

/** Deployment-owned identity facts; every field is patchable from cordis.yml. */
export interface Config {
  /** Local JSON file persisting the connector key record. */
  keyPath?: string
}

/** Remote service carrying the connector-key state. */
export default class RockOnboardingController extends TypertRemoteService {
  static inject = []
  static Config: z<Config> = z.object({
    keyPath: z.string().min(1).default(DEFAULT_KEY_PATH),
  })

  private readonly service: ConnectorKeyService

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockOnboarding')
    this.service = new ConnectorKeyService({
      keyPath: config.keyPath ?? DEFAULT_KEY_PATH,
      resolve: (baseUrl, key) => resolveKey(baseUrl, key),
    })
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

  /** Host-side read of the stored record (no Remote serialization). */
  getRecord(): ConnectorKeyRecord | null {
    return this.service.getRecord()
  }

  /** Current Seagull onboarding status, or undefined when not synced yet. */
  @Remote
  getOnboardingStatus(): string | undefined {
    const identity = this.ctx.get('seagullIdentity') as { getOnboardingStatus(): string | undefined } | undefined
    return identity?.getOnboardingStatus()
  }

  /** Validate and persist a base URL + pasted key; fails with `rockOnboarding/invalid`. */
  @Remote
  async addKey(baseUrl: string, key: string): Promise<ConnectorIdentity> {
    try {
      const identity = await this.service.addKey(baseUrl, key)
      this.notifyIdentity()
      return identity
    } catch (error) {
      throw new RemoteError('rockOnboarding/invalid', error instanceof Error ? error.message : 'invalid key', {})
    }
  }

  /** Notify seagull-identity to re-sync claims with the freshly resolved identity. */
  private notifyIdentity(): void {
    const record = this.service.getRecord()
    if (record === null) return
    const identity = this.ctx.get('seagullIdentity') as { setIdentity(baseUrl: string, employeeId: string): void; sync(): Promise<void> } | undefined
    if (identity !== undefined) {
      identity.setIdentity(record.baseUrl, record.employeeId)
      void identity.sync()
    }
  }
}

/** Resolve a base URL + raw key through the Seagull resolve endpoint. */
async function resolveKey(baseUrl: string, key: string): Promise<ConnectorIdentity | null> {
  try {
    const url = `${baseUrl}/v1/connectors/clients/resolve`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    if (!response.ok) return null
    const envelope = await response.json() as { data?: { ok?: boolean; clientId?: string; employeeId?: string } }
    const identity = envelope.data
    if (identity === undefined || !identity.ok || !identity.clientId || !identity.employeeId) return null
    return { clientId: identity.clientId, employeeId: identity.employeeId }
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
