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
 * The card's pending-action buttons. A bound but undeployed bot offers deploy
 * and debug; a deployed bot offers none because both actions live on its detail
 * drawer from then on.
 * @param bot - one unified bot row.
 * @param status - the bot's current deployment status.
 * @returns the ordered card actions, empty when the card needs no action.
 */
export function cardCtas(bot: BotRow, status: BotDeployStatus): CardCta[] {
  if (!supportsTools(bot)) return []
  if (boundToolType(bot) === undefined) return ['bind']
  if (status === 'deployed') return []
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
