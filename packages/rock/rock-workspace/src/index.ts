/**
 * Rock workspace plugin: owns the local employee workspace root that hosts the
 * task archive tree (`tasks/` + `projects/<projectId>/tasks/`) and resolves
 * per-task archive paths for the rest of the Rock composition.
 *
 * ```yaml
 * - id: rock-workspace
 *   name: '@rock/rock-workspace'
 *   config:
 *     workspacePath: ../.rock/workspace.json
 *     defaultRoot: ~/Documents/SeagullWorkspace
 * ```
 *
 * @module @rock/rock-workspace
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorkspaceService } from './service.ts'

export type * from './types.ts'

export const name = 'rock-workspace'
export const inject = []

const DEFAULT_WORKSPACE_PATH = '../.rock/workspace.json'
const DEFAULT_ROOT = '~/Documents/SeagullWorkspace'

/** Deployment-owned workspace facts; every field is patchable from cordis.yml. */
export interface Config {
  /** Local JSON file persisting the workspace state. */
  workspacePath?: string
  /** Default workspace root used on first run (may contain a leading `~`). */
  defaultRoot?: string
}

export const Config: z<Config> = z.object({
  workspacePath: z.string().min(1).default(DEFAULT_WORKSPACE_PATH),
  defaultRoot: z.string().min(1).default(DEFAULT_ROOT),
})

/** Mount the workspace service on the context. */
export function apply(ctx: Context, config: Config): void {
  const service = new WorkspaceService({
    workspacePath: config.workspacePath ?? DEFAULT_WORKSPACE_PATH,
    defaultRoot: config.defaultRoot ?? DEFAULT_ROOT,
  })
  ctx.provide('rockWorkspace', service)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Rock workspace service (root path + archive tree). */
    rockWorkspace: WorkspaceService
  }
}
