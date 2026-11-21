/**
 * Rock skill retrieval tool: model-facing `skill_get` over the Seagull LLM
 * Proxy's bot-scoped skill endpoint. The dedicated assistant resolves a bound
 * skill's slug from the injected `[技能·目录]` summary and calls this tool to
 * fetch the full content, which the proxy scopes to the employee's bot binding
 * pool. Named exports preserve loader injection metadata.
 *
 * @module @rock/rock-skill-get
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'rock-skill-get'
export const inject = ['tools']

/** No deployment-varying options; the tool reads the connector key and assistant identity from Rock services. */
export interface Config {}
export const Config: z<Config> = z.object({})

export async function apply(ctx: Context, _config: Config): Promise<void> {
  ctx.tools.register(defineTool({
    name: 'skill_get',
    description: 'Fetch the full content of a bound skill by its slug (from the injected [技能·目录] summary) so you can follow its instructions. Returns the skill name and its complete content.',
    parameters: {
      slug: {
        type: 'string',
        required: true,
        description: 'The skill slug shown in the [技能·目录] summary, e.g. rock-tool-detect or rock-runner-dsh.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string', required: true },
          name: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Loaded skill "${value.slug}"` }],
    },
    async execute(args) {
      const record = (ctx.get('rockOnboarding') as {
        getRecord(): { baseUrl: string; key: string } | null
      } | undefined)?.getRecord()
      if (record === undefined || record === null) {
        throw new Error('connector key not configured; run onboarding first')
      }
      const assistant = (ctx.get('seagullIdentity') as {
        getAssistants(): readonly { agentBotId: string }[]
      } | undefined)?.getAssistants()[0]
      if (assistant === undefined) {
        throw new Error('assistant identity not synced yet')
      }
      const url = `${record.baseUrl}/v1/bots/${assistant.agentBotId}/skills/${encodeURIComponent(args.slug)}`
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${record.key}` },
      })
      if (!response.ok) {
        throw new Error(`skill fetch failed: ${response.status}`)
      }
      const body = await response.json() as { slug?: string; name?: string; content?: string }
      return {
        slug: String(body.slug || args.slug),
        name: String(body.name || ''),
        content: String(body.content || ''),
      }
    },
  }))
}
