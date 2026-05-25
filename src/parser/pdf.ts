import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';
import { createWorker } from 'tesseract.js';
import type { Readable } from 'stream';
import type * as PdfjsLib from 'pdfjs-dist';
import type { ParserStrategy, NormalizedTransaction } from './types';
import { parseTextIntoTransactions, streamToBuffer } from './text-line-parser';
import { llamaParseBuffer, stripMarkdownTables } from './llama-parse';
import {
  parseDate,
  parseAmount,
  detectChannel,
  detectCategory,
  extractBeneficiaryId,
  // detectCountry,
  detectColumns,
} from './normalize';

// pdfjs-dist v3 legacy build: CJS-compatible
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as typeof PdfjsLib;

// Run pdfjs synchronously in the main thread — no browser worker available in Node.js
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

// TextContent and TextItem are defined in pdfjs-dist's internal display/api module
// but not re-exported from the top-level namespace; define the shapes we need here.
interface PdfTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, x, y] — x/y are the position on the page
  width: number;
}
interface PdfTextContent {
  items: (PdfTextItem | { type: string })[];
}

// Minimum total text characters across all pages to classify a PDF as text-based (not scanned)
const MIN_TEXT_LENGTH = 30;

// Render scale for scanned-page images — 2× gives Tesseract enough resolution
const RENDER_SCALE = 2.0;

// Two text items within this many PDF points on the Y axis belong to the same row
const ROW_Y_TOLERANCE = 5;

// NodeCanvasFactory tells pdfjs-dist how to create canvases in a Node.js environment
const nodeCanvasFactory = {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  },
  reset(item: { canvas: ReturnType<typeof createCanvas> }, width: number, height: number) {
    item.canvas.width = width;
    item.canvas.height = height;
  },
  destroy(item: { canvas: ReturnType<typeof createCanvas> }) {
    item.canvas.width = 0;
    item.canvas.height = 0;
  },
};

// ── Internal types ───────────────────────────────────────────────────────────

interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

interface PageRow {
  y: number;
  cells: { x: number; width: number; str: string }[];
}

type ColumnField = keyof ReturnType<typeof detectColumns>;

interface ColumnDef {
  field: ColumnField;
  x: number; // left-edge X of the header cell
}

// ── Text extraction ──────────────────────────────────────────────────────────

function extractItems(content: PdfTextContent): RawItem[] {
  return content.items
    .filter((item): item is PdfTextItem => 'str' in item && (item as PdfTextItem).str.trim() !== '')
    .map((item) => {
      const [, , , , x, y] = item.transform;
      return { str: item.str, x, y, width: item.width };
    });
}

// Groups items into visual rows by Y coordinate and sorts them top-to-bottom,
// with cells within each row sorted left-to-right.
function groupIntoRows(items: RawItem[]): PageRow[] {
  const rows: PageRow[] = [];

  for (const item of items) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= ROW_Y_TOLERANCE);
    if (row) {
      row.cells.push({ x: item.x, width: item.width, str: item.str });
    } else {
      rows.push({ y: item.y, cells: [{ x: item.x, width: item.width, str: item.str }] });
    }
  }

  // PDF Y=0 is at the bottom; higher Y = higher on page → sort descending for top-to-bottom
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
  }

  return rows;
}

function rowToText(row: PageRow): string {
  return row.cells.map((c) => c.str).join(' ').trim();
}

// ── Header detection ─────────────────────────────────────────────────────────

// Scans rows from top to bottom for a row that looks like a table header:
// must contain a date column AND at least one value column (debit/credit/amount).
function findHeaderRow(rows: PageRow[]): { index: number; columns: ColumnDef[] } | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const texts = row.cells.map((c) => c.str.trim());
    const detected = detectColumns(texts);

    if (!detected.date) continue;
    if (!detected.debit && !detected.credit && !detected.amount) continue;

    const columns: ColumnDef[] = [];
    for (const [field, headerText] of Object.entries(detected) as [ColumnField, string | undefined][]) {
      if (!headerText) continue;
      const cell = row.cells.find(
        (c) => c.str.trim().toLowerCase() === headerText.toLowerCase(),
      );
      if (cell) columns.push({ field, x: cell.x });
    }

    if (columns.length >= 2) return { index: i, columns };
  }
  return null;
}

// Returns true if a row looks like a repeated table header (for multi-page statements)
function isHeaderRow(row: PageRow): boolean {
  const texts = row.cells.map((c) => c.str.trim());
  const det = detectColumns(texts);
  return !!(det.date && (det.debit || det.credit || det.amount));
}

// ── Column assignment ────────────────────────────────────────────────────────

// Assigns a cell to the column whose header X is nearest to the cell's X.
function nearestColumn(cellX: number, columns: ColumnDef[]): ColumnDef {
  let best = columns[0];
  let bestDist = Math.abs(best.x - cellX);
  for (const col of columns.slice(1)) {
    const dist = Math.abs(col.x - cellX);
    if (dist < bestDist) {
      bestDist = dist;
      best = col;
    }
  }
  return best;
}

// ── Row parsing ──────────────────────────────────────────────────────────────

const SEPARATOR_RE = /^[-=*_. ]+$|end\s+of\s+(transactions?|statement)/i;

function parseRow(
  row: PageRow,
  columns: ColumnDef[],
): NormalizedTransaction | null {
  // Assign each cell to its nearest column, concatenating when multiple
  // items share the same column (e.g. a description split across fragments)
  const values: Record<string, string> = {};
  for (const cell of row.cells) {
    const col = nearestColumn(cell.x, columns);
    values[col.field] = values[col.field]
      ? values[col.field] + ' ' + cell.str
      : cell.str;
  }

  const date = parseDate(values.date?.trim());
  if (!date) return null;

  const description = (values.description ?? '').trim();
  if (!description) return null;

  const creditVal = parseAmount(values.credit);
  const debitVal = parseAmount(values.debit);
  const amountVal = parseAmount(values.amount);
  const balanceVal = parseAmount(values.balance);

  let amountNum: number;
  let direction: 'inflow' | 'outflow';

  // Credit column → always inflow; debit column → always outflow.
  // A combined signed-amount column uses the sign to determine direction.
  if (creditVal !== null && Math.abs(creditVal) > 0) {
    amountNum = Math.abs(creditVal);
    direction = 'inflow';
  } else if (debitVal !== null && Math.abs(debitVal) > 0) {
    amountNum = Math.abs(debitVal);
    direction = 'outflow';
  } else if (amountVal !== null && amountVal !== 0) {
    amountNum = Math.abs(amountVal);
    direction = amountVal >= 0 ? 'inflow' : 'outflow';
  } else {
    return null;
  }

  const tx: NormalizedTransaction = { date, description, amount: amountNum.toFixed(2), direction };
  if (balanceVal !== null) tx.balance = Math.abs(balanceVal).toFixed(2);

  tx.channel = detectChannel(description);
  const cat = detectCategory(description, direction);
  if (cat) tx.category = cat;
  const ben = extractBeneficiaryId(description);
  if (ben) tx.beneficiaryId = ben;
  // const country = detectCountry(description);
  // if (country) tx.country = country;

  return tx;
}

// ── Multi-page table parsing ─────────────────────────────────────────────────

function parseWithColumns(
  pageRows: PageRow[][],
  headerPageIdx: number,
  headerRowIdx: number,
  columns: ColumnDef[],
): { transactions: NormalizedTransaction[]; skipped: number } {
  const transactions: NormalizedTransaction[] = [];
  let skipped = 0;

  const dateCol = columns.find((c) => c.field === 'date');
  const descCol = columns.find((c) => c.field === 'description');

  for (let pi = headerPageIdx; pi < pageRows.length; pi++) {
    const rows = pageRows[pi];
    const startRow = pi === headerPageIdx ? headerRowIdx + 1 : 0;

    for (let ri = startRow; ri < rows.length; ri++) {
      const row = rows[ri];
      const text = rowToText(row);

      if (!text || SEPARATOR_RE.test(text)) continue;
      // Skip repeated header rows (common on multi-page statements)
      if (isHeaderRow(row)) continue;

      const tx = parseRow(row, columns);
      if (tx) {
        transactions.push(tx);
        continue;
      }

      // No date found — check if this row continues the previous description.
      // A continuation row has no cell in the date-column area that parses as
      // a date, and has at least one cell near the description column.
      if (transactions.length > 0 && descCol) {
        const hasNewDate =
          dateCol !== undefined &&
          row.cells.some(
            (c) =>
              Math.abs(c.x - dateCol.x) < 30 &&
              parseDate(c.str.trim()) !== null,
          );

        if (!hasNewDate) {
          const descCells = row.cells.filter(
            (c) => Math.abs(c.x - descCol.x) < 100,
          );
          if (descCells.length > 0) {
            const last = transactions[transactions.length - 1];
            last.description += ' ' + descCells.map((c) => c.str).join(' ');
            continue;
          }
        }
      }

      skipped++;
    }
  }

  return { transactions, skipped };
}

// ── Parser class ─────────────────────────────────────────────────────────────

export class PdfParser implements ParserStrategy {
  async parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(readFileSync(filePath), filePath.split(/[\\/]/).pop() ?? 'document.pdf');
  }

  async parseStream(stream: Readable): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(await streamToBuffer(stream));
  }

  private async parseBuffer(
    buffer: Buffer,
    filename = 'document.pdf',
  ): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const markdown = await llamaParseBuffer(buffer, 'application/pdf', filename);
    if (markdown) {
      const result = parseTextIntoTransactions(stripMarkdownTables(markdown));
      if (result.transactions.length > 0) return result;
    }

    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

    // Extract structured text items from every page
    const pageRows: PageRow[][] = [];
    let totalTextLen = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent() as unknown as PdfTextContent;
      const items = extractItems(content);
      totalTextLen += items.reduce((s, it) => s + it.str.length, 0);
      pageRows.push(groupIntoRows(items));
    }

    // Scanned PDF (no embedded text) — fall back to OCR
    if (totalTextLen < MIN_TEXT_LENGTH) {
      return this.ocrPages(pdf);
    }

    // Search for a structured table header row across all pages
    for (let pi = 0; pi < pageRows.length; pi++) {
      const result = findHeaderRow(pageRows[pi]);
      if (result) {
        const structured = parseWithColumns(pageRows, pi, result.index, result.columns);
        if (structured.transactions.length > 0) return structured;
        // Header found but column-based parsing yielded nothing (e.g. X misalignment
        // from right-aligned amounts) — fall through to the text-based fallback.
        break;
      }
    }

    // No table header found, or structured parsing yielded nothing —
    // reconstruct ordered text and use the line-based parser.
    const text = pageRows.flat().map(rowToText).join('\n');
    return parseTextIntoTransactions(text);
  }

  private async ocrPages(
    pdf: PdfjsLib.PDFDocumentProxy,
  ): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const worker = await createWorker('eng');
    const pageTexts: string[] = [];

    try {
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: RENDER_SCALE });

        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        // pdfjs types expect the browser CanvasRenderingContext2D; node-canvas is
        // API-compatible at runtime, and canvasFactory is not in the public type
        // signatures, so we cast the whole params object through any here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.render({ canvasContext: context, viewport, canvasFactory: nodeCanvasFactory } as any).promise;

        const {
          data: { text },
        } = await worker.recognize(canvas.toBuffer('image/png'));
        pageTexts.push(text);
      }
    } finally {
      await worker.terminate();
    }

    return parseTextIntoTransactions(pageTexts.join('\n'));
  }
}
