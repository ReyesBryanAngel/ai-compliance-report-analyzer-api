#!/usr/bin/env node
// Renders a local HTML bank-statement file to PDF via puppeteer-core.
// Used by the bank-statement-generator subagent to produce test fixtures.
//
// Usage: node scripts/render-statement-pdf.mjs <input.html> <output.pdf>

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const [, , inputHtml, outputPdf] = process.argv;

if (!inputHtml || !outputPdf) {
  console.error('Usage: node scripts/render-statement-pdf.mjs <input.html> <output.pdf>');
  process.exit(1);
}

if (!existsSync(inputHtml)) {
  console.error(`Input HTML not found: ${inputHtml}`);
  process.exit(1);
}

const CANDIDATE_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

const executablePath = CANDIDATE_PATHS.find((p) => existsSync(p));

if (!executablePath) {
  console.error(
    'No local Chrome/Chromium/Edge executable found. Set PUPPETEER_EXECUTABLE_PATH to a browser binary path.',
  );
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath, headless: true });

try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(inputHtml).href, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: outputPdf,
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
  });
} finally {
  await browser.close();
}

console.log(`Wrote ${outputPdf}`);
