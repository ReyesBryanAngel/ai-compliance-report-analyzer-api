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
