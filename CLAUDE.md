# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload via tsx watch)
npm run dev

# Build
npm run build

# Production
npm run start

# Database
npm run db:migrate        # Run migrations in dev
npm run db:migrate:deploy # Deploy migrations to production
npm run db:generate       # Regenerate Prisma client after schema changes
npm run db:studio         # Open Prisma Studio GUI
npm run db:reset          # Reset database and re-run all migrations
```

No test runner is configured yet.

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default `3000`) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `DATABASE_URL` | PostgreSQL connection string |

## Architecture

The API is built with **Fastify v5** and **Prisma v7** (PostgreSQL via `pg` + `@prisma/adapter-pg`). All routes are versioned under `/api/v1/`.

### Request Lifecycle

`server.ts` → `buildApp()` (app.ts) → registers plugins in order → mounts routes

Plugin registration order matters: `helmet` → `cors` → `sensible` → `multipart` → custom Prisma plugin → routes.

### End-to-End Compliance Flow

1. Client uploads documents (CSV bank statements) → `POST /api/v1/documents/upload`
2. Client requests a report with document IDs and workflow names → `POST /api/v1/reports/generate`
3. Reports service resolves & validates documents, then parses each file via the parser factory
4. Normalized transactions flow into the risk engine, which runs the selected workflows
5. Findings are persisted as `ComplianceCheck` records; the `Report` record is updated to `COMPLETED`

### Adding a New Feature Module

Follow the pattern in [src/documents/](src/documents/) and [src/reports/](src/reports/):
- `routes.ts` — FastifyPluginAsync, registered via `registerRoutes` in [src/routes/index.ts](src/routes/index.ts)
- `service.ts` — business/data-access logic
- `types.ts` — TypeScript types specific to the module

Register the new plugin in [src/routes/index.ts](src/routes/index.ts) with its `/api/v1/<resource>` prefix.

### Prisma Plugin

[src/plugins/prisma.ts](src/plugins/prisma.ts) decorates the Fastify instance with `server.prisma`. It manages a `pg` connection pool and attaches a `PrismaPg` adapter. Use `request.server.prisma` inside route handlers. After editing `prisma/schema.prisma`, always run `npm run db:generate` to regenerate the client in `src/generated/prisma/`.

### File Uploads

[src/documents/service.ts](src/documents/service.ts) streams uploaded files to `uploads/documents/` using Node.js `pipeline` with a `Transform` stream that counts bytes in flight — no buffering in memory. MIME types are validated against `ALLOWED_MIME_TYPES` before writing. Failed streams must be drained to avoid hanging requests (see the catch block in [src/documents/routes.ts](src/documents/routes.ts)).

Multipart limits (set in `app.ts`): 10 MB per file, 10 files per request.

### Parser Module

[src/parser/](src/parser/) is a polymorphic parsing layer. `getParser(mimeType)` returns a `ParserStrategy` or `null`; currently only `text/csv` is implemented. The `CsvParser` uses header alias matching (case-insensitive fuzzy column detection) to handle varied bank statement formats, resolving amounts from either a single signed column or separate debit/credit columns.

All parsers output `NormalizedTransaction[]`:

```typescript
type NormalizedTransaction = {
  date: string;          // ISO 8601
  description: string;
  amount: number;        // always positive
  direction: 'inflow' | 'outflow';
  balance?: number;
  category?: string;     // salary, utilities, loan_payment, etc.
  channel?: 'bank' | 'ewallet' | 'transfer' | 'card' | 'atm';
  currency?: string;
  reference?: string;
};
```

[src/parser/normalize.ts](src/parser/normalize.ts) handles date formats (ISO 8601, DD-Mon-YYYY, MM/DD/YYYY), amount edge cases (parentheses notation, currency symbols), channel detection (GCash, PayMaya, ATM keywords), and category detection by keyword patterns.

To add a new parser (e.g., PDF), implement `ParserStrategy` and register the MIME type in [src/parser/index.ts](src/parser/index.ts).

### Risk Engine

[src/risk-engine/](src/risk-engine/) is a pluggable workflow + checkpoint framework. Entry point:

```typescript
runRiskEngine(transactions: NormalizedTransaction[], workflows: string[]): RiskReport
```

**Workflows** live in [src/risk-engine/workflows/](src/risk-engine/workflows/). Each workflow composes multiple checkpoints and returns a `WorkflowResult` with an `overallScore` (0–100) and `findings[]`. Currently registered: `kyc`.

**Checkpoints** live in [src/risk-engine/checkpoints/](src/risk-engine/checkpoints/). Each returns a `RiskFinding`:

```typescript
type RiskFinding = {
  checkpoint: string;
  triggered: boolean;
  severity: 'low' | 'medium' | 'high';
  score: number;        // 0–100
  reason: string;
  evidence: NormalizedTransaction[];
};
```

**KYC workflow** runs two checkpoints:

- **recurring-salary** — 5-signal weighted confidence model (keyword match 30pts, monthly pattern 25pts, stable amount 20pts, consistent sender 15pts, bank channel 10pts). Confidence ≥70% = low risk; 40–69% = medium; <40% = high. Triggers at 90pts if no salary detected.
- **income-consistency** — Coefficient of variation (CV) on monthly inflow totals + linear regression trend. CV >50% = high risk; CV 25–50% = medium; CV <25% = low. Declining income adds one severity level.

To add a checkpoint: create a file in [src/risk-engine/checkpoints/](src/risk-engine/checkpoints/), export a function returning `RiskFinding`, and import it in the relevant workflow.

### Reports Module

[src/reports/service.ts](src/reports/service.ts) orchestrates the full pipeline: document resolution → parsing → risk engine → persistence. Key behaviors:

- Validates `workflows` against `SUPPORTED_WORKFLOWS` before doing any work
- Accepts `document_ids`, `batch_id`, or both (set union); documents must be in `PROCESSED` status
- Sets `Report.status = ANALYZING` before parsing, `COMPLETED` on success, `FAILED` on any thrown error
- Stores `RiskReport` and `ReportSummary` as JSON inside `Report.content`
- Each `RiskFinding` is also persisted as a `ComplianceCheck` row (rule = checkpoint name, passed = `!triggered`, details = JSON)

### Database Schema

| Model | Purpose |
|---|---|
| `User` | Account; owns many `Report`s |
| `Report` | Compliance report; stores `documentIds[]`, `workflows[]`, and JSON `content` (risk results + summary) |
| `ComplianceCheck` | One row per `RiskFinding`; `rule` = checkpoint name, `details` = JSON with scores |
| `Document` | Uploaded file metadata with status enum (`PENDING` → `PROCESSING` → `PROCESSED`/`FAILED`) |

All primary keys are UUIDs. Cascade deletes: `Report` → `ComplianceCheck`; `User` → `Report` (SetNull on Report.userId).

### Logging

Fastify's built-in logger is used throughout. Development uses `pino-pretty` with debug-level output; production uses JSON at info level. Use `request.log` in route handlers and `server.log` elsewhere.
