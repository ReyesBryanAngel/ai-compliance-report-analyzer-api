#!/usr/bin/env node
// Benchmarks document processing against a running API, separately for each file type pds
// parses (pdf, csv, jpeg, png, webp) and each batch size.
//
// For each type and batch size it uploads that many documents of that type (cycling through the
// sample files), then waits until every one of them has finished parsing. The headline number is
// the overall completion time: from the start of the upload until the last document reached
// COMPLETED. That is the number the "seconds, not minutes" promise is about. Documents are checked
// every 2 seconds, so completion times are accurate to about ±2 seconds. Types and sizes run one
// after another, so one round's parse backlog never slows the next.
//
// Sample files are found in --files and its subfolders and grouped by extension. Run
// scripts/generate-benchmark-samples.mjs first to create the csv/, png/, jpg/ and webp/ samples.
//
// Every uploaded PDF/image is parsed by LlamaParse, so a run spends real parsing credits and
// leaves the documents in S3 and the database. CSV is parsed locally and costs nothing. The total
// is (sum of --sizes) × (number of --types), so start with small sizes.
//
// Usage:
//   BENCH_EMAIL=you@example.com BENCH_PASSWORD=secret node scripts/benchmark-upload.mjs --sizes 5,10
//   node scripts/benchmark-upload.mjs --token <jwt> --types pdf,csv --sizes 50,100 --mode presigned
//
// Options:
//   --types <list>        Comma-separated file types to benchmark: pdf, csv, jpeg, png, webp
//                         (default: every type that has sample files)
//   --sizes <list>        Comma-separated batch sizes, run for each type (default 10)
//   --mode <m>            direct (POST /documents/upload, multipart) or presigned
//                         (upload-url → PUT to S3 → confirm). Default direct
//   --files <dir>         Folder of sample files, searched with its subfolders (default test-data/bank-statements)
//   --base-url <url>      API base URL (default $BENCH_BASE_URL or http://localhost:3001)
//   --token <jwt>         Use this access token instead of logging in with BENCH_EMAIL/BENCH_PASSWORD
//   --per-request <n>     Files per multipart request in direct mode (default 10, the server's limit)
//   --concurrency <n>     Requests in flight at once (default 3 for direct, 10 for presigned)
//   --parse-timeout <s>   Give up waiting for parsing after this many seconds (default 900)

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { performance } from 'node:perf_hooks';

// The file types pds parses (PARSEABLE_MIME_TYPES in src/parser/index.ts), in report order.
const FILE_TYPES = {
  pdf: { mimeType: 'application/pdf', exts: ['.pdf'], llamaParse: true },
  csv: { mimeType: 'text/csv', exts: ['.csv'], llamaParse: false },
  jpeg: { mimeType: 'image/jpeg', exts: ['.jpg', '.jpeg'], llamaParse: true },
  png: { mimeType: 'image/png', exts: ['.png'], llamaParse: true },
  webp: { mimeType: 'image/webp', exts: ['.webp'], llamaParse: true },
};

function typeOfFile(name) {
  const ext = extname(name).toLowerCase();
  return Object.keys(FILE_TYPES).find((t) => FILE_TYPES[t].exts.includes(ext));
}

const PARSE_POLL_INTERVAL_MS = 2_000;

function parseArgs(argv) {
  const opts = {
    types: null,
    sizes: [10],
    mode: 'direct',
    files: 'test-data/bank-statements',
    baseUrl: process.env.BENCH_BASE_URL || 'http://localhost:3001',
    token: null,
    perRequest: 10,
    concurrency: null,
    parseTimeoutS: 900,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case '--types': opts.types = next().split(',').map((t) => (t.trim().toLowerCase() === 'jpg' ? 'jpeg' : t.trim().toLowerCase())); break;
      case '--sizes': opts.sizes = next().split(',').map((s) => Number(s.trim())); break;
      case '--mode': opts.mode = next(); break;
      case '--files': opts.files = next(); break;
      case '--base-url': opts.baseUrl = next(); break;
      case '--token': opts.token = next(); break;
      case '--per-request': opts.perRequest = Number(next()); break;
      case '--concurrency': opts.concurrency = Number(next()); break;
      case '--parse-timeout': opts.parseTimeoutS = Number(next()); break;
      case '-h':
      case '--help':
        console.log('See the usage comment at the top of scripts/benchmark-upload.mjs');
        process.exit(0);
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!['direct', 'presigned'].includes(opts.mode)) throw new Error(`--mode must be direct or presigned`);
  if (opts.sizes.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error('--sizes must be positive integers');
  const unknownTypes = (opts.types ?? []).filter((t) => !FILE_TYPES[t]);
  if (unknownTypes.length) throw new Error(`Unknown --types: ${unknownTypes.join(', ')}. Use: ${Object.keys(FILE_TYPES).join(', ')}`);
  opts.concurrency ??= opts.mode === 'direct' ? 3 : 10;
  opts.baseUrl = opts.baseUrl.replace(/\/$/, '');
  return opts;
}

function formatDuration(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${totalSeconds.toFixed(1)} seconds (${minutes}m ${seconds.toFixed(1)}s)`;
}

// Runs async tasks with at most `limit` in flight.
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function api(opts, path, init = {}) {
  const res = await fetch(`${opts.baseUrl}/api/v1${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body?.message ?? text}`);
  return body;
}

async function login(opts) {
  const email = process.env.BENCH_EMAIL;
  const password = process.env.BENCH_PASSWORD;
  if (!email || !password) throw new Error('Set BENCH_EMAIL and BENCH_PASSWORD, or pass --token');
  const body = await api(opts, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return body.token;
}

// Loads every sample file under `dir` (including subfolders), grouped by file type.
async function loadSamples(dir) {
  const entries = await readdir(dir, { recursive: true });
  const byType = {};
  for (const relPath of entries.sort()) {
    const type = typeOfFile(relPath);
    if (!type) continue;
    (byType[type] ??= []).push({
      name: basename(relPath),
      mimeType: FILE_TYPES[type].mimeType,
      data: await readFile(join(dir, relPath)),
    });
  }
  return byType;
}

// Builds `count` uploads by cycling through the samples, each with a unique filename.
function buildUploads(samples, count, runLabel) {
  return Array.from({ length: count }, (_, i) => {
    const sample = samples[i % samples.length];
    const ext = extname(sample.name);
    return {
      ...sample,
      filename: `${runLabel}-${String(i + 1).padStart(4, '0')}-${basename(sample.name, ext)}${ext}`,
    };
  });
}

async function uploadDirect(opts, uploads, batchName) {
  const chunks = [];
  for (let i = 0; i < uploads.length; i += opts.perRequest) chunks.push(uploads.slice(i, i + opts.perRequest));

  const responses = await runPool(chunks, opts.concurrency, async (chunk, i) => {
    const form = new FormData();
    // batch_name must come before the file parts or the server ignores it.
    form.append('batch_name', `${batchName} (part ${i + 1})`);
    for (const u of chunk) form.append('files', new Blob([u.data], { type: u.mimeType }), u.filename);
    try {
      return await api(opts, '/documents/upload', { method: 'POST', body: form });
    } catch (err) {
      return { documents: [], failed: chunk.map((u) => ({ filename: u.filename, error: err.message })) };
    }
  });

  return {
    documentIds: responses.flatMap((r) => r.documents.map((d) => d.id)),
    failed: responses.flatMap((r) => r.failed),
  };
}

async function uploadPresigned(opts, uploads, batchName) {
  const byFilename = new Map(uploads.map((u) => [u.filename, u]));
  const { documents, failed } = await api(opts, '/documents/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: uploads.map((u) => ({ filename: u.filename })), batchName }),
  });

  const results = await runPool(documents, opts.concurrency, async ({ uploadUrl, document }) => {
    const upload = byFilename.get(document.originalName);
    try {
      // The pre-signed URL is signed with this Content-Type, so it must match exactly.
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': document.mimeType },
        body: upload.data,
      });
      if (!put.ok) throw new Error(`S3 PUT → ${put.status}: ${await put.text()}`);
      await api(opts, `/documents/${document.id}/confirm`, { method: 'POST' });
      return { id: document.id };
    } catch (err) {
      return { failed: { filename: document.originalName, error: err.message } };
    }
  });

  return {
    documentIds: results.filter((r) => r.id).map((r) => r.id),
    failed: [...failed, ...results.filter((r) => r.failed).map((r) => r.failed)],
  };
}

// Polls the document list until every uploaded document is COMPLETED or FAILED, recording how
// long after `start` each document was first seen COMPLETED.
async function waitForParse(opts, documentIds, start) {
  const pending = new Set(documentIds);
  const completedAtMs = [];
  let parseFailed = 0;
  const deadline = performance.now() + opts.parseTimeoutS * 1000;

  while (pending.size > 0 && performance.now() < deadline) {
    const { documents } = await api(opts, '/documents/list');
    const now = performance.now() - start;
    for (const doc of documents) {
      if (!pending.has(doc.id)) continue;
      if (doc.status === 'COMPLETED') {
        pending.delete(doc.id);
        completedAtMs.push(now);
      } else if (doc.status === 'FAILED') {
        pending.delete(doc.id);
        parseFailed++;
      }
    }
    process.stdout.write(
      `\r  processing: ${completedAtMs.length} completed, ${parseFailed} failed, ${pending.size} pending   `,
    );
    if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, PARSE_POLL_INTERVAL_MS));
  }
  process.stdout.write('\n');
  return { completedAtMs, parseFailed, timedOut: pending.size };
}

async function runSize(opts, type, samples, size) {
  const runLabel = `bench-${type}${size}-${Date.now()}`;
  const uploads = buildUploads(samples, size, runLabel);
  console.log(`\n▶ ${type.toUpperCase()}: ${size} documents (${opts.mode} mode)`);

  const start = performance.now();
  const { documentIds, failed } =
    opts.mode === 'direct'
      ? await uploadDirect(opts, uploads, runLabel)
      : await uploadPresigned(opts, uploads, runLabel);
  const uploadMs = performance.now() - start;
  console.log(`  uploaded: ${documentIds.length}/${size} in ${formatDuration(uploadMs)}`);
  for (const f of failed.slice(0, 5)) console.log(`  failed: ${f.filename}: ${f.error}`);
  if (failed.length > 5) console.log(`  …and ${failed.length - 5} more failures`);

  const result = { type, size, uploadFailed: failed.length, uploadMs, completedAtMs: [], parseFailed: 0, timedOut: 0 };
  if (documentIds.length > 0) {
    const parse = await waitForParse(opts, documentIds, start);
    Object.assign(result, parse);
  }

  const completed = result.completedAtMs.length;
  if (completed > 0) {
    const sorted = [...result.completedAtMs].sort((a, b) => a - b);
    result.allCompletedMs = sorted[sorted.length - 1];
    result.firstCompletedMs = sorted[0];
    result.avgCompletedMs = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    console.log(`  ${completed}/${size} COMPLETED — last one at ${formatDuration(result.allCompletedMs)}`);
  } else {
    console.log(`  0/${size} COMPLETED`);
  }
  return result;
}

function printSummary(results) {
  console.log('\n=== Summary: time from start of upload until documents are COMPLETED ===');
  let currentType = null;
  for (const r of results) {
    if (r.type !== currentType) {
      currentType = r.type;
      console.log(`\n${r.type.toUpperCase()}`);
    }
    const completed = r.completedAtMs.length;
    const problems = [
      r.uploadFailed && `${r.uploadFailed} upload failed`,
      r.parseFailed && `${r.parseFailed} parse failed`,
      r.timedOut && `${r.timedOut} still pending at timeout`,
    ].filter(Boolean);
    const note = problems.length ? ` [${problems.join(', ')}]` : '';

    if (completed === 0) {
      console.log(`${r.size} upload docs = none reached COMPLETED${note}`);
      continue;
    }
    const countLabel = completed === r.size ? `${r.size}` : `${completed} of ${r.size}`;
    console.log(`${countLabel} upload docs = ${formatDuration(r.allCompletedMs)}${note}`);
    console.log(
      `    upload only: ${formatDuration(r.uploadMs)} | first COMPLETED: ${formatDuration(r.firstCompletedMs)}` +
        ` | average per doc: ${formatDuration(r.avgCompletedMs)}`,
    );
  }
  console.log('\n(Completion times are checked every 2 seconds, so they are accurate to about ±2 seconds.)');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const samplesByType = await loadSamples(opts.files);
  const types = opts.types ?? Object.keys(FILE_TYPES).filter((t) => samplesByType[t]);
  const missing = types.filter((t) => !samplesByType[t]);
  if (missing.length) {
    throw new Error(
      `No sample files for: ${missing.join(', ')} in ${opts.files}. Run node scripts/generate-benchmark-samples.mjs first.`,
    );
  }
  if (types.length === 0) throw new Error(`No sample files in ${opts.files}`);
  opts.token ??= await login(opts);

  const perType = opts.sizes.reduce((a, b) => a + b, 0);
  const llamaParseDocs = types.filter((t) => FILE_TYPES[t].llamaParse).length * perType;
  console.log(`API: ${opts.baseUrl} | mode: ${opts.mode} | files: ${opts.files}`);
  console.log(`Types: ${types.map((t) => `${t} (${samplesByType[t].length} samples)`).join(', ')}`);
  console.log(
    `⚠ This uploads ${perType * types.length} documents in total; ${llamaParseDocs} of them are parsed by LlamaParse and cost credits.`,
  );

  const results = [];
  for (const type of types) {
    for (const size of opts.sizes) results.push(await runSize(opts, type, samplesByType[type], size));
  }
  printSummary(results);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});
