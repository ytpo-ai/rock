/**
 * Per-bot action matrix for the Bot management card and detail drawer. The
 * card carries only the bot's next pending action; every action lives on the
 * detail drawer, and the dedicated assistant has none of them because it needs
 * neither an external tool nor a debug run.
 *
 * @module @rock/rock-bot-manager/client/bot-card-state
 */
import type { BotDeploymentRow, BotRow } from '@rock/rock-bot-manager/types'

/** One bot's deployment status, including the pre-record `undeployed` state. */
export type BotDeployStatus = BotDeploymentRow['status']

/** Card action: bind an execution backend, deploy, or debug the bound backend. */
export type CardCta = 'bind' | 'deploy' | 'debug'

/** Detail action: every action the drawer can offer for a bot. */
export type DetailAction = 'bind' | 'deploy' | 'debug' | 'proxy' | 'edit' | 'delete'

/**
 * Whether the bot source binds or runs external tools at all. The dedicated
 * assistant routes through the system relay, so it carries no bind, deploy, or
 * debug action.
 * @param bot - one unified bot row.
 * @returns false only for the dedicated assistant.
 */
export function supportsTools(bot: BotRow): boolean {
  return bot.source !== 'assistant'
}

/**
 * The bot's bound execution backend.
 * @param bot - one unified bot row.
 * @returns the bound tool type, or undefined while the bot is unbound.
 */
export function boundToolType(bot: BotRow): string | undefined {
  return bot.tool?.toolType
}

/**
 * The bot's raw model id for change detection. Cloud bots carry `modelId`
 * (the raw Seagull model id, distinct from the display-name `llm.model`);
 * local bots fall back to their own `llm.model`.
 * @param bot - one unified bot row.
 * @returns the raw model id, or undefined when the bot has none.
 */
export function currentModelId(bot: BotRow): string | undefined {
  const id = bot.modelId ?? bot.llm?.model
  return id === undefined || id === '' ? undefined : id
}

/**
 * Whether a deployed bot's current model differs from the model last written
 * to its external tool, so it needs a redeploy.
 * @param bot - one unified bot row.
 * @param deployment - the bot's deployment row, or undefined when Rock has no record.
 * @returns true only when the bot is deployed and its model changed.
 */
export function modelChanged(bot: BotRow, deployment: BotDeploymentRow | undefined): boolean {
  if (deployment?.status !== 'deployed') return false
  const deployed = deployment.deployedModel
  const current = currentModelId(bot)
  return deployed !== undefined && current !== undefined && current !== deployed
}

/**
 * The card's pending-action buttons. A bound but undeployed bot offers deploy
 * and debug; a deployed bot offers none, except a redeploy when its model
 * changed since the last deploy, because both actions otherwise live on its
 * detail drawer from then on.
 * @param bot - one unified bot row.
 * @param status - the bot's current deployment status.
 * @param deployment - the bot's deployment row, or undefined when Rock has no record.
 * @returns the ordered card actions, empty when the card needs no action.
 */
export function cardCtas(bot: BotRow, status: BotDeployStatus, deployment?: BotDeploymentRow): CardCta[] {
  if (!supportsTools(bot)) return []
  if (boundToolType(bot) === undefined) return ['bind']
  if (status === 'deployed') return modelChanged(bot, deployment) ? ['deploy'] : []
  if (status === 'deploying') return ['deploy']
  return ['deploy', 'debug']
}

/**
 * The detail drawer's actions. Bind and proxy follow the source permissions;
 * debug is always offered and reports the missing binding through its disabled
 * reason; deploy appears only once the bot is deployable.
 * @param bot - one unified bot row.
 * @param deployable - whether the bot's deployment can be started.
 * @returns the ordered detail actions.
 */
export function detailActions(bot: BotRow, deployable: boolean): DetailAction[] {
  if (!supportsTools(bot)) return []
  const actions: DetailAction[] = []
  if (bot.canRebind) actions.push('bind')
  if (bot.source === 'claimed' && deployable) actions.push('deploy')
  actions.push('debug')
  if (bot.source === 'claimed') actions.push('proxy')
  if (bot.source === 'local') actions.push('edit')
  if (bot.canDelete) actions.push('delete')
  return actions
}

/**
 * The disabled reason for binding while the bot has an active cloud task.
 * @param bot - one unified bot row.
 * @param activeLabel - localized "running" label.
 * @param lockedLabel - localized "assistant cannot rebind" label.
 * @returns the localized reason, or undefined when the binding can change.
 */
export function bindLockedReason(bot: BotRow, activeLabel: string, lockedLabel: string): string | undefined {
  if (bot.active) return activeLabel
  return bot.canRebind ? undefined : lockedLabel
}

/**
 * Whether the bot can be deployed at all, independent of its current status.
 * @param row - the bot's deployment row, or undefined when Rock has no record.
 * @returns true when the row reports a deployable bot.
 */
export function isDeployable(row: BotDeploymentRow | undefined): boolean {
  return row?.deployable === true
}
