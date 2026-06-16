import { getAnthropicClient } from './service';
import { AgentSkillExecutionError } from '../agent-skills/errors';
import { AGENT_SKILL_OUTPUT_SCHEMA } from '../agent-skills/schema';
import type { AgentSkillOutput } from '../agent-skills/schema';

export async function generateAgentSkillFindings(
  system: string,
  user: string,
): Promise<{ data: AgentSkillOutput; raw: string }> {
  const client = getAnthropicClient();
  if (!client) {
    throw new AgentSkillExecutionError('ANTHROPIC_API_KEY is not configured');
  }

  const model = process.env.ANTHROPIC_AGENT_SKILL_MODEL || 'claude-sonnet-4-6';

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [
      {
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: AGENT_SKILL_OUTPUT_SCHEMA,
      },
    } as Parameters<typeof client.messages.create>[0]['output_config'],
    messages: [{ role: 'user', content: user }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new AgentSkillExecutionError('Model returned no text content');
  }

  return { data: JSON.parse(textBlock.text) as AgentSkillOutput, raw: textBlock.text };
}
