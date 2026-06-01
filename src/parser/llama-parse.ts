import {
  parseDate,
  parseAmount,
  detectChannel,
  detectCategory,
  extractBeneficiaryId,
  detectColumns,
} from './normalize';
import type { NormalizedTransaction } from './types';

const BASE_URL = 'https://api.cloud.llamaindex.ai/api/parsing';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20; // up to ~60 seconds

// Instructs LlamaParse to focus on financial transaction tables rather than
// general document layout — improves extraction quality for bank statements
// and utility bills without requiring a custom schema.
const PARSING_INSTRUCTION =
  'This document is a bank statement or utility bill. ' +
  'Extract all transaction rows. Each row contains a date, description, ' +
  'and one or more monetary amounts (debit, credit, or balance). ' +
  'Preserve the tabular structure as a markdown table.';

type JobStatus = 'PENDING' | 'SUCCESS' | 'ERROR';

interface UploadResponse { id: string }
interface JobResponse    { id: string; status: JobStatus }
interface ResultResponse { markdown: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a file buffer to LlamaParse and returns the extracted markdown, or
 * null if the API key is absent, the job fails, or a network error occurs.
 * The caller is responsible for falling back to a local parser on null.
 */
export async function llamaParseBuffer(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string | null> {
  const apiKey = process.env.LLAMA_PARSE_API_KEY;
  if (!apiKey) return null;

  let jobId: string;
  try {
    const arrayBuf = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;

    const form = new FormData();
    form.append('file', new Blob([arrayBuf], { type: mimeType }), filename);
    form.append('parsing_instruction', PARSING_INSTRUCTION);

    const uploadRes = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!uploadRes.ok) return null;
    const upload = (await uploadRes.json()) as UploadResponse;
    jobId = upload.id;
  } catch {
    return null;
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const jobRes = await fetch(`${BASE_URL}/job/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!jobRes.ok) return null;

      const job = (await jobRes.json()) as JobResponse;
      if (job.status === 'ERROR') return null;

      if (job.status === 'SUCCESS') {
        const resultRes = await fetch(`${BASE_URL}/job/${jobId}/result/markdown`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!resultRes.ok) return null;
        const result = (await resultRes.json()) as ResultResponse;
        return result.markdown ?? null;
      }
    } catch {
      return null;
    }
  }

  return null; // polling timeout
}

/**
 * Converts LlamaParse markdown table rows into plain space-separated lines so
 * that parseTextIntoTransactions (which expects lines starting with a date) can
 * process them.
 *
 * Input:  | Jan 15, 2024 | GCash Transfer |        | 50,000.00 | 150,000.00 |
 * Output: Jan 15, 2024  GCash Transfer  50,000.00  150,000.00
 *
 * Non-table lines (headings, prose) are passed through unchanged.
 */
export function stripMarkdownTables(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^\|[-| :]+\|$/.test(trimmed)) return ''; // separator row (|---|---|)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        return trimmed
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join('  ');
      }
      return line;
    })
    .join('\n');
}

// Scans date cell strings from a table block to detect DD/MM/YYYY vs MM/DD/YYYY.
// If any cell has a first component > 12 the format must be DMY; if any has a
// second component > 12 it must be MDY; otherwise returns undefined (caller
// falls back to the US-convention default in parseDate).
function inferDateFormat(dateCells: string[]): 'dmy' | 'mdy' | undefined {
  for (const cell of dateCells) {
    const m = cell.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/);
    if (!m) continue;
    if (parseInt(m[1]) > 12) return 'dmy';
    if (parseInt(m[2]) > 12) return 'mdy';
  }
  return undefined;
}

// Rows whose description cell indicate they are summary/footer rows, not transactions.
const TABLE_SUMMARY_RE =
  /^(starting balance|ending balance|total\s+(debit|credit)|opening balance|closing balance)/i;

function parseCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map((c) => c.trim());
}

/**
 * Parses LlamaParse markdown output directly into NormalizedTransaction[],
 * preserving column semantics (Debit vs Credit, Reference No., Date and Time).
 *
 * This avoids the bugs of the flatten-then-parse approach:
 * - Time in "Date and Time" cells no longer bleeds into description or amounts
 * - Reference number columns are not mistaken for transaction amounts
 * - Debit/Credit columns correctly set direction without keyword heuristics
 */
export function parseLlamaMarkdownToTransactions(markdown: string): {
  transactions: NormalizedTransaction[];
  skipped: number;
} {
  const transactions: NormalizedTransaction[] = [];
  let skipped = 0;
  // Tracks the running balance across rows to correct direction when LlamaParse
  // misplaces a value in the wrong Debit/Credit column.
  let prevBalance: number | null = null;

  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].trim().startsWith('|')) { i++; continue; }

    // Collect the contiguous block of table lines
    const tableLines: string[] = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      tableLines.push(lines[i]);
      i++;
    }

    // Find the separator row that divides header from data
    const sepIdx = tableLines.findIndex((l) => /^\|[-| :]+\|$/.test(l.trim()));
    if (sepIdx <= 0) continue; // no valid header+separator found

    const headers = parseCells(tableLines[sepIdx - 1]);
    const detected = detectColumns(headers);

    if (!detected.date) continue;
    if (!detected.debit && !detected.credit && !detected.amount) continue;

    // Map each detected field to its column index
    type ColField = keyof ReturnType<typeof detectColumns>;
    const colIdx: Partial<Record<ColField, number>> = {};
    for (const [field, headerText] of Object.entries(detected) as [ColField, string | undefined][]) {
      if (!headerText) continue;
      const idx = headers.findIndex((h) => h.toLowerCase() === headerText.toLowerCase());
      if (idx !== -1) colIdx[field] = idx;
    }

    // Pre-scan all date cells in this table to detect DD/MM vs MM/DD format before
    // committing to any individual row — required when no date has a first component
    // > 12 (e.g. a UK statement where all days happen to be ≤ 12).
    const rawDateCells = tableLines
      .slice(sepIdx + 1)
      .map((l) => {
        const c = parseCells(l);
        return colIdx.date !== undefined ? (c[colIdx.date] ?? '') : '';
      })
      .filter(Boolean);
    const dateFormat = inferDateFormat(rawDateCells);

    for (const line of tableLines.slice(sepIdx + 1)) {
      if (/^\|[-| :]+\|$/.test(line.trim())) continue; // skip extra separator rows

      const cells = parseCells(line);
      if (cells.length === 0) continue;

      // Skip summary/footer rows — but seed prevBalance from starting/opening balance rows
      const descCell = colIdx.description !== undefined ? (cells[colIdx.description] ?? '') : '';
      const firstNonEmpty = cells.find((c) => c !== '') ?? '';
      if (TABLE_SUMMARY_RE.test(descCell) || TABLE_SUMMARY_RE.test(firstNonEmpty)) {
        if (/starting balance|opening balance/i.test(descCell) || /starting balance|opening balance/i.test(firstNonEmpty)) {
          const startBal = parseAmount(colIdx.balance !== undefined ? cells[colIdx.balance] : undefined);
          if (startBal !== null) prevBalance = startBal;
        }
        continue;
      }

      const dateRaw = colIdx.date !== undefined ? cells[colIdx.date] : undefined;
      const date = parseDate(dateRaw?.trim(), dateFormat);
      if (!date) { skipped++; continue; }

      const description = descCell.trim();
      if (!description) { skipped++; continue; }

      const creditVal = parseAmount(colIdx.credit !== undefined ? cells[colIdx.credit] : undefined);
      const debitVal  = parseAmount(colIdx.debit  !== undefined ? cells[colIdx.debit]  : undefined);
      const amountVal = parseAmount(colIdx.amount  !== undefined ? cells[colIdx.amount] : undefined);
      const balanceVal = parseAmount(colIdx.balance !== undefined ? cells[colIdx.balance] : undefined);

      let amountNum: number;
      let direction: 'inflow' | 'outflow';

      if (creditVal !== null && creditVal > 0) {
        amountNum = creditVal;
        direction = 'inflow';
      } else if (debitVal !== null && debitVal !== 0) {
        // LlamaParse may render debit amounts as negative (-250.00); treat any
        // non-zero value in the Debit column as an outflow regardless of sign.
        amountNum = Math.abs(debitVal);
        direction = 'outflow';
      } else if (amountVal !== null && amountVal !== 0) {
        amountNum = Math.abs(amountVal);
        direction = amountVal >= 0 ? 'inflow' : 'outflow';
      } else {
        skipped++;
        continue;
      }

      // LlamaParse sometimes places a credit value in the Debit column (or vice
      // versa) due to visual misalignment in the source PDF. When a running
      // balance is available, use the balance delta as ground truth to override
      // the direction derived from the column position.
      if (balanceVal !== null && prevBalance !== null) {
        const delta = balanceVal - prevBalance;
        if (Math.abs(delta) > 0.001) {
          const impliedDirection: 'inflow' | 'outflow' = delta > 0 ? 'inflow' : 'outflow';
          if (impliedDirection !== direction) direction = impliedDirection;
        }
      }
      prevBalance = balanceVal ?? prevBalance;

      const tx: NormalizedTransaction = {
        date,
        description,
        amount: amountNum.toFixed(2),
        direction,
      };

      if (balanceVal !== null) tx.balance = Math.abs(balanceVal).toFixed(2);

      const refCell = colIdx.reference !== undefined ? cells[colIdx.reference]?.trim() : undefined;
      if (refCell) tx.reference = refCell;

      tx.channel = detectChannel(description);
      const cat = detectCategory(description, direction);
      if (cat) tx.category = cat;
      const ben = extractBeneficiaryId(description);
      if (ben) tx.beneficiaryId = ben;

      transactions.push(tx);
    }
  }

  return { transactions, skipped };
}
