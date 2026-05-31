import { NumericTransaction, RiskFinding } from '../types';

const MIN_SAMPLE = 5;
// Two transactions sharing the same fingerprint within this many days = suspicious
const CLONE_GAP_DAYS = 20;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

// Strip trailing reference codes (e.g. "REF0001", "TXN20241105") to catch
// fabrications where only the reference field was incremented between copies.
function normalizeDesc(description: string): string {
  return description
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+[a-z]{1,4}\d{4,}\s*$/i, '')
    .replace(/\s+\d{6,}\s*$/, '')
    .trim();
}

function cloneKey(tx: NumericTransaction): string {
  return `${tx.amount}|${tx.direction}|${normalizeDesc(tx.description)}`;
}

function exactKey(tx: NumericTransaction): string {
  return `${tx.date}|${tx.amount}|${tx.direction}|${tx.description.toLowerCase().trim()}`;
}

export function checkClonedTransactionPattern(
  transactions: NumericTransaction[],
): RiskFinding {
  if (transactions.length < MIN_SAMPLE) {
    return {
      checkpoint: 'cloned-transaction-pattern',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: `Too few transactions (${transactions.length}) for clone analysis — minimum ${MIN_SAMPLE} required`,
      evidence: [],
    };
  }

  // Pass 1: same-day exact duplicates — identical (date, amount, direction, description)
  const byExactKey = new Map<string, NumericTransaction[]>();
  for (const tx of transactions) {
    const key = exactKey(tx);
    const bucket = byExactKey.get(key) ?? [];
    bucket.push(tx);
    byExactKey.set(key, bucket);
  }
  const sameDayDupes = [...byExactKey.values()].filter((g) => g.length >= 2).flat();

  // Pass 2: clone clusters — same fingerprint, any consecutive pair within CLONE_GAP_DAYS
  const byCloneKey = new Map<string, NumericTransaction[]>();
  for (const tx of transactions) {
    const key = cloneKey(tx);
    const bucket = byCloneKey.get(key) ?? [];
    bucket.push(tx);
    byCloneKey.set(key, bucket);
  }

  const clusterEvidence: NumericTransaction[] = [];
  for (const group of byCloneKey.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const isSuspicious = sorted.some(
      (tx, i) => i > 0 && daysBetween(sorted[i - 1].date, tx.date) < CLONE_GAP_DAYS,
    );
    if (isSuspicious) clusterEvidence.push(...group);
  }

  // Deduplicate across both passes (a same-day dupe is also caught by cluster pass)
  const evidenceSet = new Set<NumericTransaction>([...sameDayDupes, ...clusterEvidence]);
  const evidence = [...evidenceSet];

  const hasSameDayDupes = sameDayDupes.length > 0;
  const cloneRatio = evidence.length / transactions.length;

  if (!hasSameDayDupes && cloneRatio < 0.05) {
    return {
      checkpoint: 'cloned-transaction-pattern',
      triggered: false,
      severity: 'low',
      score: 10,
      reason: `No significant clone pattern detected (clone ratio ${(cloneRatio * 100).toFixed(1)}%)`,
      evidence: [],
    };
  }

  const ratioLabel = `clone ratio ${(cloneRatio * 100).toFixed(1)}%`;

  if (hasSameDayDupes || cloneRatio >= 0.30) {
    const parts: string[] = [];
    if (hasSameDayDupes) {
      parts.push(`${sameDayDupes.length} same-day exact duplicate(s) detected`);
    }
    if (cloneRatio >= 0.30) {
      parts.push(`${ratioLabel} — majority of transactions are near-duplicates`);
    }
    return {
      checkpoint: 'cloned-transaction-pattern',
      triggered: true,
      severity: 'high',
      score: 90,
      reason: parts.join('; '),
      evidence,
    };
  }

  if (cloneRatio >= 0.15) {
    return {
      checkpoint: 'cloned-transaction-pattern',
      triggered: true,
      severity: 'high',
      score: 75,
      reason: `High clone ratio (${(cloneRatio * 100).toFixed(1)}%) — significant repeated transaction patterns suggest document manipulation`,
      evidence,
    };
  }

  return {
    checkpoint: 'cloned-transaction-pattern',
    triggered: true,
    severity: 'medium',
    score: 55,
    reason: `Moderate clone ratio (${(cloneRatio * 100).toFixed(1)}%) — repeated transaction patterns warrant review`,
    evidence,
  };
}
