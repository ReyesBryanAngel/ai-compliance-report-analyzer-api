import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { SANCTIONS_LIST, SanctionedEntity, WatchlistSource } from '../data/sanctions-list';

// ── Text normalization ─────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Returns tokens with ≥3 chars. Short tokens (articles, prepositions) cause false positives. */
function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(t => t.length >= 3);
}

/**
 * Returns true when all significant tokens of `entityName` appear in the
 * token set derived from `target`. This handles:
 *   - Abbreviations:   "IRGC" in "Transfer IRGC Holdings"
 *   - Reordered names: "Cruz Dela Juan" matching "Juan Dela Cruz"
 *   - Extra words:     "Payment from Bank Melli Iran Ltd" matching "Bank Melli Iran"
 */
function nameMatchesTarget(entityName: string, targetTokenSet: Set<string>): boolean {
  const nameTokens = tokens(entityName);
  if (nameTokens.length === 0) return false;
  return nameTokens.every(t => targetTokenSet.has(t));
}

// ── Fields extracted per transaction ──────────────────────────────────────

type ScreenedField = 'description' | 'beneficiaryId' | 'reference';

function extractScreenableText(tx: NormalizedTransaction): Partial<Record<ScreenedField, string>> {
  const fields: Partial<Record<ScreenedField, string>> = {};
  if (tx.description) fields.description = tx.description;
  if (tx.beneficiaryId) {
    // beneficiaryId format: "name:juan-dela-cruz" | "phone:09171234567" | "acct:1234567890"
    // Only the name prefix carries a screenable name.
    const raw = tx.beneficiaryId;
    if (raw.startsWith('name:')) {
      fields.beneficiaryId = raw.slice(5).replace(/-/g, ' ');
    }
  }
  if (tx.reference) fields.reference = tx.reference;
  return fields;
}

// ── Core screening ─────────────────────────────────────────────────────────

type MatchDetail = {
  entity: SanctionedEntity;
  matchedName: string;
  field: ScreenedField;
};

function screenTransaction(tx: NormalizedTransaction): MatchDetail | null {
  const fields = extractScreenableText(tx);

  for (const [field, text] of Object.entries(fields) as [ScreenedField, string][]) {
    const targetTokenSet = new Set(tokens(text));

    for (const entity of SANCTIONS_LIST) {
      for (const name of entity.names) {
        if (nameMatchesTarget(name, targetTokenSet)) {
          return { entity, matchedName: name, field };
        }
      }
    }
  }

  return null;
}

// ── Checkpoint ────────────────────────────────────────────────────────────

const LIST_LABEL: Record<WatchlistSource, string> = {
  'ofac-sdn': 'OFAC SDN',
  un: 'UN Consolidated',
  eu: 'EU Sanctions',
  amlc: 'AMLC',
};

export function checkSanctionsWatchlist(transactions: NormalizedTransaction[]): RiskFinding {
  type HitRecord = { tx: NormalizedTransaction; detail: MatchDetail };
  const hits: HitRecord[] = [];

  for (const tx of transactions) {
    const detail = screenTransaction(tx);
    if (detail) hits.push({ tx, detail });
  }

  if (hits.length === 0) {
    return {
      checkpoint: 'sanctions-watchlist',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: `No matches against sanctions or watchlists across ${transactions.length} transaction(s).`,
      evidence: [],
    };
  }

  // Deduplicate evidence transactions.
  const seen = new Set<string>();
  const evidence: NormalizedTransaction[] = [];
  for (const { tx } of hits) {
    const key = `${tx.date}-${tx.amount}-${tx.description}`;
    if (!seen.has(key)) {
      seen.add(key);
      evidence.push(tx);
    }
  }

  // Summarise distinct matches for the reason string.
  const byList = new Map<WatchlistSource, Set<string>>();
  for (const { detail } of hits) {
    const { list, id } = detail.entity;
    if (!byList.has(list)) byList.set(list, new Set());
    byList.get(list)!.add(`${detail.matchedName} [${id}]`);
  }

  const listSummaries = [...byList.entries()]
    .map(([list, names]) => `${LIST_LABEL[list]}: ${[...names].join(', ')}`)
    .join('; ');

  return {
    checkpoint: 'sanctions-watchlist',
    triggered: true,
    severity: 'high',
    score: 100,
    reason: `${evidence.length} transaction(s) matched sanctioned/watchlisted entities — ${listSummaries}. Mandatory reporting and asset freeze review required.`,
    evidence,
  };
}
