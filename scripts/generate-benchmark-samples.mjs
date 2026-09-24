#!/usr/bin/env node
// Generates sample files in every format pds parses, for scripts/benchmark-upload.mjs.
//
// - png/, jpg/, webp/: page 1 of each PDF in the source folder, rendered as an image (the way a
//   player's phone photo or screenshot of a statement would arrive).
// - csv/: synthetic bank statements with Date, Description, Debit, Credit and Balance columns.
//   CSV is parsed locally, so its content only needs to be realistic in shape and size.
//
// Output is deterministic, so re-running produces the same files.
//
// Usage:
//   node scripts/generate-benchmark-samples.mjs [--source test-data/bank-statements] [--csv-count 12]

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { PDFParse } from 'pdf-parse';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const IMAGE_SCALE = 2; // ~1190×1684 px for A4, similar to a phone photo of a page
const LOSSY_QUALITY = 85;

function parseArgs(argv) {
  const opts = { source: 'test-data/bank-statements', csvCount: 12 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') opts.source = argv[++i];
    else if (argv[i] === '--csv-count') opts.csvCount = Number(argv[++i]);
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return opts;
}

async function renderImages(source) {
  const pdfs = (await readdir(source)).filter((n) => extname(n).toLowerCase() === '.pdf').sort();
  if (pdfs.length === 0) throw new Error(`No PDFs in ${source}`);
  for (const dir of ['png', 'jpg', 'webp']) await mkdir(join(source, dir), { recursive: true });

  for (const name of pdfs) {
    const parser = new PDFParse({ data: await readFile(join(source, name)) });
    try {
      const shot = await parser.getScreenshot({ partial: [1], scale: IMAGE_SCALE, imageBuffer: true, imageDataUrl: false });
      const png = Buffer.from(shot.pages[0].data);
      const image = await loadImage(png);
      const canvas = createCanvas(image.width, image.height);
      canvas.getContext('2d').drawImage(image, 0, 0);

      const stem = basename(name, '.pdf');
      await writeFile(join(source, 'png', `${stem}.png`), png);
      await writeFile(join(source, 'jpg', `${stem}.jpg`), await canvas.encode('jpeg', LOSSY_QUALITY));
      await writeFile(join(source, 'webp', `${stem}.webp`), await canvas.encode('webp', LOSSY_QUALITY));
      console.log(`  images: ${stem} (${image.width}×${image.height})`);
    } finally {
      await parser.destroy();
    }
  }
  return pdfs.length;
}

// Small seeded PRNG (mulberry32) so the CSVs are identical on every run.
function prng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUTFLOWS = [
  ['TESCO STORES', 8, 90], ['SAINSBURYS', 6, 80], ['AMAZON UK', 5, 150], ['TFL TRAVEL', 2, 40],
  ['BRITISH GAS DD', 60, 140], ['COUNCIL TAX DD', 110, 180], ['VODAFONE DD', 20, 55],
  ['NETFLIX', 5, 18], ['ATM WITHDRAWAL', 20, 200], ['BET365 GAMING', 5, 250],
  ['SKY BET', 10, 200], ['PAYPAL *TRANSFER', 10, 300], ['RENT STANDING ORDER', 700, 1400],
];
const INFLOWS = [['SALARY ACME LTD', 1800, 3200], ['FASTER PAYMENT RECEIVED', 20, 500], ['REFUND', 5, 80]];

function csvStatement(index) {
  const rand = prng(1000 + index);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const amount = ([, min, max]) => Math.round((min + rand() * (max - min)) * 100) / 100;

  const rowCount = 40 + index * 25; // 40 … ~315 rows, to cover short and long statements
  let balance = Math.round((500 + rand() * 3000) * 100) / 100;
  const day = new Date(Date.UTC(2026, 0, 1));
  const lines = ['Date,Description,Debit,Credit,Balance'];

  for (let i = 0; i < rowCount; i++) {
    if (rand() < 0.4) day.setUTCDate(day.getUTCDate() + 1);
    const isInflow = rand() < (i % 30 === 0 ? 1 : 0.12);
    const entry = isInflow ? pick(INFLOWS) : pick(OUTFLOWS);
    const value = amount(entry);
    balance = Math.round((balance + (isInflow ? value : -value)) * 100) / 100;
    const debit = isInflow ? '' : value.toFixed(2);
    const credit = isInflow ? value.toFixed(2) : '';
    lines.push(`${day.toISOString().slice(0, 10)},${entry[0]},${debit},${credit},${balance.toFixed(2)}`);
  }
  return lines.join('\n') + '\n';
}

async function writeCsvs(source, count) {
  await mkdir(join(source, 'csv'), { recursive: true });
  for (let i = 1; i <= count; i++) {
    const name = `synthetic-statement-${String(i).padStart(2, '0')}.csv`;
    await writeFile(join(source, 'csv', name), csvStatement(i));
  }
  console.log(`  csv: ${count} synthetic statements`);
}

const opts = parseArgs(process.argv.slice(2));
console.log(`Generating benchmark samples in ${opts.source}`);
const imageCount = await renderImages(opts.source);
await writeCsvs(opts.source, opts.csvCount);
console.log(`Done: ${imageCount} each of png/jpg/webp, ${opts.csvCount} csv.`);
