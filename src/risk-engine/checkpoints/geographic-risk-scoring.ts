import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { jurisdictionRisk, JurisdictionRisk } from '../data/high-risk-countries';

export type GeographicRiskThresholds = {
  /** Minimum transaction amount (PHP) to consider; filters trivial FX noise. */
  minAmount: number;
  /**
   * Weighted risk exposure ratio (0–1) at or below which the checkpoint is not triggered.
   * Computed as sum(amount × tierWeight for flagged txs) / totalAmount.
   * E.g. 0.05 = ≤5% of total value flows through elevated-risk jurisdictions (weighted).
   */
  exposureGreenRatio: number;
  /** Weighted exposure ratio at or below which severity is medium; above → high. */
  exposureAmberRatio: number;
  /** Number of distinct elevated-risk jurisdictions at or below which no trigger. */
  greenMax: number;
  /** Distinct elevated-risk jurisdiction count at or below which severity is medium; above → high. */
  amberMax: number;
};

export const GEO_RISK_DEFAULTS: GeographicRiskThresholds = {
  minAmount: 1_000,
  exposureGreenRatio: 0.05,
  exposureAmberRatio: 0.20,
  greenMax: 1,
  amberMax: 3,
};

// Risk weight per tier — contributes to weighted exposure score.
// Blacklist is handled via immediate escalation (score 100); weights cover remaining tiers.
const TIER_WEIGHT: Partial<Record<JurisdictionRisk, number>> = {
  greylist: 0.6,
  offshore: 0.4,
  'eu-blacklist': 0.3,
};

type Severity = 'low' | 'medium' | 'high';

function bandSeverity(value: number, greenMax: number, amberMax: number): Severity {
  if (value <= greenMax) return 'low';
  if (value <= amberMax) return 'medium';
  return 'high';
}

function worstSeverity(a: Severity, b: Severity): Severity {
  const rank: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function checkGeographicRiskScoring(
  transactions: NormalizedTransaction[],
  thresholds: GeographicRiskThresholds = GEO_RISK_DEFAULTS,
): RiskFinding {
  const {
    minAmount,
    exposureGreenRatio,
    exposureAmberRatio,
    greenMax,
    amberMax,
  } = thresholds;

  const qualifying = transactions.filter(t => t.amount >= minAmount);
  const totalValue = qualifying.reduce((sum, t) => sum + t.amount, 0);

  if (qualifying.length === 0 || totalValue === 0) {
    return {
      checkpoint: 'geographic-risk-scoring',
      triggered: false,
      severity: 'low',
      score: 10,
      reason: 'No qualifying transactions for geographic risk assessment.',
      evidence: [],
    };
  }

  // ── Phase 1: Blacklist — immediate escalation ─────────────────────────────
  const blacklistTxs = qualifying.filter(
    t => t.country && jurisdictionRisk(t.country) === 'blacklist',
  );

  if (blacklistTxs.length > 0) {
    const jurisdictions = [...new Set(blacklistTxs.map(t => t.country!.toUpperCase()))].join(', ');
    return {
      checkpoint: 'geographic-risk-scoring',
      triggered: true,
      severity: 'high',
      score: 100,
      reason: `${blacklistTxs.length} transaction(s) linked to FATF-blacklisted jurisdiction(s): ${jurisdictions}. Geographic risk: critical.`,
      evidence: blacklistTxs,
    };
  }

  // ── Phase 2: Weighted exposure across elevated-risk tiers ─────────────────
  // Groups flagged transactions by counterparty country code for evidence and reporting.
  const byCountry = new Map<string, { tier: JurisdictionRisk; txs: NormalizedTransaction[] }>();
  let weightedRiskValue = 0;

  for (const t of qualifying) {
    if (!t.country) continue;
    const tier = jurisdictionRisk(t.country);
    const weight = TIER_WEIGHT[tier];
    if (weight === undefined) continue; // 'none' or 'blacklist' (handled above)

    weightedRiskValue += t.amount * weight;

    const code = t.country.toUpperCase();
    if (!byCountry.has(code)) byCountry.set(code, { tier, txs: [] });
    byCountry.get(code)!.txs.push(t);
  }

  const exposureRatio = weightedRiskValue / totalValue;
  const distinctCount = byCountry.size;

  // ── Phase 3: Determine severity from both independent signals ─────────────
  // A large exposure ratio OR many distinct risky jurisdictions each independently elevate risk.
  const exposureSev = bandSeverity(exposureRatio, exposureGreenRatio, exposureAmberRatio);
  const jurisdictionSev = bandSeverity(distinctCount, greenMax, amberMax);
  const severity = worstSeverity(exposureSev, jurisdictionSev);
  const triggered = severity !== 'low';

  // ── Evidence deduplication ────────────────────────────────────────────────
  const seen = new Set<string>();
  const evidence: NormalizedTransaction[] = [];
  for (const { txs } of byCountry.values()) {
    for (const t of txs) {
      const key = `${t.date}-${t.amount}-${t.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push(t);
      }
    }
  }

  // ── Reason string ─────────────────────────────────────────────────────────
  const exposurePct = (exposureRatio * 100).toFixed(1);
  const jurisdictionList = [...byCountry.entries()]
    .map(([code, { tier }]) => `${code} (${tier})`)
    .join(', ');

  const reason =
    distinctCount === 0
      ? `No elevated-risk jurisdiction exposure detected across ${qualifying.length} qualifying transaction(s).`
      : `Weighted geographic risk exposure: ${exposurePct}% of total value (PHP ${totalValue.toLocaleString()}) across ${distinctCount} elevated-risk jurisdiction(s) — ${jurisdictionList}.`;

  return {
    checkpoint: 'geographic-risk-scoring',
    triggered,
    severity,
    score: triggered ? (severity === 'high' ? 90 : 60) : 10,
    reason,
    evidence,
  };
}
