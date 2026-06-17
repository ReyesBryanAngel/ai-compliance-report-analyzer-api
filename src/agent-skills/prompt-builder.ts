import type { NumericTransaction } from '../risk-engine/types';
import type { CheckpointCatalogEntry } from './types';
import { AGENT_SKILL_OUTPUT_SCHEMA } from './schema';

export interface PromptContext {
  workflowSlug: string;
  instructions: string;
  checkpointCatalog: CheckpointCatalogEntry[];
  transactions: NumericTransaction[];
  metadata?: {
    documentName?: string;
    dateRange?: { from: string; to: string };
  };
}

export function buildAgentSkillPrompt(ctx: PromptContext): { system: string; user: string } {
  const catalogLines = ctx.checkpointCatalog
    .map((cp) => `- ${cp.slug} — ${cp.name}${cp.description ? ': ' + cp.description : ''}`)
    .join('\n');

  const schemaJson = JSON.stringify(AGENT_SKILL_OUTPUT_SCHEMA, null, 2);

  const system = `You are an expert compliance analyst performing a "${ctx.workflowSlug}" workflow analysis.

Your task is to analyze bank statement transactions and produce structured risk findings.

## Output Format
You MUST respond with valid JSON matching this schema exactly:
${schemaJson}

Rules:
- Each finding MUST include a "checkpoint" slug, "triggered" (true if risk detected), "severity" ("low"/"medium"/"high"), "score" (0-100), "reason" (human-readable explanation), and "evidenceIndices" (0-based indices into the transaction array).
- Score range: 0 = no risk, 100 = maximum risk.
- IMPORTANT: Complete your full analysis before committing to "triggered", "score", and "severity". These fields MUST reflect your FINAL conclusion after verification — not an initial hypothesis. If your investigation concludes the risk pattern is NOT present, you MUST set triggered=false, score=0, severity="low".
- The "reason" field must open with your conclusion ("No discrepancies detected." / "X discrepancies found."), then briefly explain your verification. Do NOT use "reason" as a scratchpad — state the conclusion first.
- triggered=true and score>0 are only valid when your final conclusion confirms the risk pattern is present with concrete evidence.
- evidenceIndices must reference valid 0-based positions in the transaction array provided. Use an empty array [] if there is no specific evidence.

## Checkpoint Catalog
Prefer the following checkpoint slugs when your finding corresponds to one of these topics. This ensures findings integrate with existing threshold configuration:

${catalogLines}

You may introduce new checkpoint slugs prefixed "ai-" (e.g. "ai-unusual-merchant-category") for risk patterns the above catalog does not cover, but only when the SME instructions specifically call for it.`;

  const txArray = ctx.transactions.map((tx, i) => ({ idx: i, ...tx }));

  const metaLines: string[] = [];
  if (ctx.metadata?.documentName) metaLines.push(`Document: ${ctx.metadata.documentName}`);
  if (ctx.metadata?.dateRange) {
    metaLines.push(`Date range: ${ctx.metadata.dateRange.from} to ${ctx.metadata.dateRange.to}`);
  }
  metaLines.push(`Total transactions: ${ctx.transactions.length}`);

  const user = `## SME Compliance Instructions
${ctx.instructions}

## Statement Metadata
${metaLines.join('\n')}

## Transactions
Each transaction object below has an "idx" field that is its 0-based position in the array. Use these idx values as evidenceIndices in your findings.

${JSON.stringify(txArray, null, 2)}`;

  return { system, user };
}

// Hardcoded fallback instructions used when no AgentSkillInstruction row exists (e.g. fresh DB, seed skipped).
// These are kept in sync with the seed content in prisma/seed.ts as a safety net.
export const DEFAULT_INSTRUCTIONS: Record<string, string> = {
  kyc: `You are reviewing transactions for the "KYC (Know Your Customer)" compliance workflow.

Assess whether the transactions exhibit the described pattern for each topic below:

- recurring-salary — Recurring Salary: Detects stable, recurring salary inflows using a 5-signal confidence model.
- income-consistency — Income Consistency: Measures month-over-month income stability via coefficient of variation and trend analysis.
- loan-stacking — Loan Stacking Indicators: Counts loan disbursement inflows to detect multiple concurrent credit facilities.
- low-balance-persistence — Low Balance Persistence: Counts months where the end-of-month balance was below 20% of average monthly inflow.

If you identify a risk pattern not covered above, create a finding with a new checkpoint slug prefixed "ai-".`,

  sg: `You are reviewing transactions for the "Safer Gambling" compliance workflow.

Assess whether the transactions exhibit the described pattern for each topic below:

- gambling-debits — Gambling Debits: Counts outflow (debit) transactions made to gambling merchants.
- gambling-days — Gambling Days: Counts the number of distinct calendar days with any gambling activity.
- gambling-activity — Gambling Activity: Counts total gambling-related transactions (both inflows and outflows).
- gambling-overdrafts — Gambling Overdrafts: Counts gambling outflow transactions that resulted in a negative account balance.

If you identify a risk pattern not covered above, create a finding with a new checkpoint slug prefixed "ai-".`,

  traml: `You are reviewing transactions for the "Transaction Risk & AML" compliance workflow.

Assess whether the transactions exhibit the described pattern for each topic below:

- rapid-inflow-outflow — Rapid Inflow/Outflow: Counts cycles where a significant inflow is followed by outflows draining ≥80% of it within 72 hours — a layering indicator.
- rapid-movement-of-funds — Rapid Movement of Funds: Counts non-overlapping 24-hour windows where the total amount moved exceeds a velocity threshold — a structuring indicator.
- circular-transaction — Circular Transaction: Counts outflows that are returned to the account at a matching amount (±5%) within 72 hours — a round-trip / layering indicator.
- fragmented-transactions — Fragmented Transactions: Counts clusters of sub-threshold outflows to the same recipient that collectively breach the reporting limit within a rolling window — a structuring/smurfing indicator.
- ctr-threshold — CTR Threshold Detection: Flags single transactions and same-day aggregates that meet or exceed the Cash Transaction Reporting (CTR) limit per AMLC rules.
- cross-border-transfer — Cross-Border Transfer: Flags transactions involving high-risk foreign jurisdictions and detects multi-currency mixing patterns within a rolling window — indicators of offshore layering.
- sanctions-watchlist — Sanctions Watchlist: Matches transaction descriptions against a curated sanctions and watchlist database to flag dealings with prohibited entities or individuals.

If you identify a risk pattern not covered above, create a finding with a new checkpoint slug prefixed "ai-".`,

  'document-integrity': `You are reviewing transactions for the "Document Integrity" compliance workflow.

Assess whether the transactions exhibit the described pattern for each topic below:

- statement-balance-discrepancy — Statement Balance Discrepancy: Counts transactions where the reported running balance does not match the computed balance from prior transactions — a strong indicator of statement forgery or manipulation.
- amount-digit-distribution — Amount Digit Distribution: Applies Benford's Law to transaction amounts to detect digit-frequency anomalies that suggest fabricated or manipulated figures.
- cloned-transaction-pattern — Cloned Transaction Pattern: Detects duplicate transactions sharing the same amount, description, and direction within a short window — a common artifact of statement forgery where only reference codes are incremented.
- round-amount-concentration — Round Amount Concentration: Flags statements where an abnormally high proportion of transaction amounts are whole numbers (no cent values) — a strong indicator of manually fabricated or manipulated entries.

If you identify a risk pattern not covered above, create a finding with a new checkpoint slug prefixed "ai-".`,
};
