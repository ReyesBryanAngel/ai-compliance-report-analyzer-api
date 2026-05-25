import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';
import { createWorker } from 'tesseract.js';
import type { Readable } from 'stream';
import type * as PdfjsLib from 'pdfjs-dist';
import type { ParserStrategy, NormalizedTransaction } from './types';
import { parseTextIntoTransactions, streamToBuffer } from './text-line-parser';

// pdf-parse v2: CJS package, no bundled types — exports a class, not a function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse') as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> } };

// pdfjs-dist v3 legacy build: CJS-compatible
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as typeof PdfjsLib;

// Run pdfjs synchronously in the main thread — no browser worker available in Node.js
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

// Minimum characters from pdf-parse to classify a PDF as text-based (not scanned)
const MIN_TEXT_LENGTH = 30;

// Render scale for scanned-page images — 2× gives tesseract enough resolution
const RENDER_SCALE = 2.0;

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

export class PdfParser implements ParserStrategy {
  async parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(readFileSync(filePath));
  }

  async parseStream(stream: Readable): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(await streamToBuffer(stream));
  }

  private async parseBuffer(buffer: Buffer): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const parser = new PDFParse({ data: buffer });
    const { text } = await parser.getText();
    await parser.destroy();

    if (text.trim().length >= MIN_TEXT_LENGTH) {
      // Text-based PDF — fast path, no OCR needed
      return parseTextIntoTransactions(text);
    }

    // Scanned PDF — render each page to an image and run OCR
    return this.ocrPages(buffer);
  }

  private async ocrPages(buffer: Buffer): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const pdf = await pdfjsLib
      .getDocument({ data: new Uint8Array(buffer) })
      .promise;

    const worker = await createWorker('eng');
    const pageTexts: string[] = [];

    try {
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: RENDER_SCALE });

        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        // pdfjs types expect the browser CanvasRenderingContext2D; node-canvas is
        // API-compatible at runtime so we cast through any here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.render({ canvasContext: context, viewport, canvasFactory: nodeCanvasFactory } as any).promise;

        const { data: { text } } = await worker.recognize(canvas.toBuffer('image/png'));
        pageTexts.push(text);
      }
    } finally {
      await worker.terminate();
    }

    return parseTextIntoTransactions(pageTexts.join('\n'));
  }
}
