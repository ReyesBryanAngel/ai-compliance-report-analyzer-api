import { getAnthropicClient } from './service';

export type ConversationHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConversationResponse = {
  content: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
};

export async function generateConversationResponse(
  systemPrompt: string,
  history: ConversationHistoryItem[],
  userMessage: string,
): Promise<ConversationResponse> {
  const client = getAnthropicClient();
  if (!client) {
    throw Object.assign(new Error('Anthropic API key not configured'), { code: 'LLM_UNAVAILABLE' });
  }

  const model = process.env.ANTHROPIC_REPORT_CHAT_MODEL || 'claude-haiku-4-5-20251001';

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const startedAt = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });

  const latencyMs = Date.now() - startedAt;

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw Object.assign(new Error('Empty response from LLM'), { code: 'LLM_EMPTY_RESPONSE' });
  }

  return {
    content: textBlock.text,
    model: response.model,
    provider: 'anthropic',
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
    latencyMs,
  };
}
