import Anthropic from '@anthropic-ai/sdk';
import type { RiskReport } from '../risk-engine/types';
import type { ReportSummary } from '../reports/types';
import type { LLMNarrative } from './types';

const SYSTEM_PROMPT = `You are an expert compliance analyst reviewing bank statement risk analysis results. Your job is to translate technical findings into clear, professional language for compliance officers.

Guidelines:
- Be concise and factual; avoid technical jargon
- For triggered (at-risk) findings, describe the observed behavior and why it matters
- For non-triggered findings, briefly confirm what was verified as acceptable
- Reviewer notes must be actionable and ordered by severity`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: { type: 'string' },
    findingExplanations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          checkpoint: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['checkpoint', 'explanation'],
        additionalProperties: false,
      },
    },
    reviewerNotes: { type: 'string' },
  },
  required: ['executiveSummary', 'findingExplanations', 'reviewerNotes'],
  additionalProperties: false,
};

let anthropic: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

export async function generateNarrative(
  riskReport: RiskReport,
  summary: ReportSummary,
): Promise<LLMNarrative | null> {
  const client = getClient();
  if (!client) return null;

  const payload = {
    overallRiskScore: summary.overallRiskScore,
    totalTransactions: summary.totalTransactions,
    totalDocuments: summary.totalDocuments,
    triggeredChecks: summary.triggeredChecks,
    highRiskFindings: summary.highRiskFindings,
    findings: riskReport.workflows.flatMap((w) =>
      w.findings.map((f) => ({
        workflow: w.workflow,
        checkpoint: f.checkpoint,
        triggered: f.triggered,
        severity: f.severity,
        score: f.score,
        reason: f.reason,
        evidenceCount: f.evidence.length,
      })),
    ),
  };

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      // thinking: { type: 'adaptive' } as Parameters<typeof client.messages.create>[0]['thinking'], ////use only for claude-opus-4-7
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        // effort: 'medium', //use only for claude-opus-4-7
        format: {
          type: 'json_schema',
          name: 'compliance_narrative',
          schema: OUTPUT_SCHEMA,
        },
      } as Parameters<typeof client.messages.create>[0]['output_config'],
      messages: [
        {
          role: 'user',
          content: `Generate a compliance narrative for these bank statement risk analysis results:\n\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;
    return JSON.parse(textBlock.text) as LLMNarrative;
  } catch (err) {
    // Narrative is best-effort — never fail report generation because of it
    console.error('[LLM] Failed to generate narrative:', err);
    return null;
  }
}
