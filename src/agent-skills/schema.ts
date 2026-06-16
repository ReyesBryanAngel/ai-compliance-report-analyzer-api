import { z } from 'zod';

export const AGENT_SKILL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          checkpoint:      { type: 'string' },
          triggered:       { type: 'boolean' },
          severity:        { type: 'string', enum: ['low', 'medium', 'high'] },
          score:           { type: 'number' },
          reason:          { type: 'string' },
          evidenceIndices: { type: 'array', items: { type: 'integer' } },
        },
        required: ['checkpoint', 'triggered', 'severity', 'score', 'reason', 'evidenceIndices'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const;

export const AgentSkillOutputSchema = z.object({
  findings: z.array(
    z.object({
      checkpoint:      z.string(),
      triggered:       z.boolean(),
      severity:        z.enum(['low', 'medium', 'high']),
      score:           z.number(),
      reason:          z.string(),
      evidenceIndices: z.array(z.number().int()),
    }),
  ),
});

export type AgentSkillOutput = z.infer<typeof AgentSkillOutputSchema>;
