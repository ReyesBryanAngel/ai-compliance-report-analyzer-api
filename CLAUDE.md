# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Context

This API powers **pds Tech** (https://pds-tech.ai/), a self-serve API for screening iGaming players' financial documents (bank statements, payslips) against 60+ risk indicators, with a "seconds, not minutes" latency promise, full audit trail, and per-page pricing tiers. See [docs/PDS_TECH.md](docs/PDS_TECH.md) for the product's customer-facing promises, how they map to our workflows, and the pricing plans. Check design decisions (parser choice, latency, tenancy, audit) against it.

Known multi-tenant gaps (cross-org data leaks, plan quotas and page billing, queue fairness, multi-server job safety, audit and retention) are tracked as a checklist in [docs/MULTI_TENANT_GAPS.md](docs/MULTI_TENANT_GAPS.md). Check it before working on tenancy, queues, uploads or billing, and tick items off there as they're fixed. The planned move from the app's own JWT auth to Amazon Cognito, including its design decisions (such as a separate `User.cognitoSub`, never used as `User.id`), is in [docs/COGNITO_PLAN.md](docs/COGNITO_PLAN.md).

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
npm run db:seed           # Seed the database (prisma/seed.ts)
```

No test runner is configured yet.

Other scripts (run with `node`):
- `scripts/render-statement-pdf.mjs <input.html> <output.pdf>` — renders HTML to PDF with `puppeteer-core` and a local Chrome/Edge; used by the `bank-statement-generator` agent
- `scripts/generate-benchmark-samples.mjs` → `scripts/benchmark-upload.mjs` — generate CSV/image samples from `test-data/bank-statements`, then time upload → parse completion per file type and batch size against a running server. PDF/image runs spend real LlamaParse credits and leave documents in S3 and the database; usage is in each script's header

`postman_collection.json` at the repo root covers the API endpoints.

Deployment is currently described only by [render.yaml](render.yaml) (Render.com: `npm install && npm run build`, then `prisma migrate deploy` and `node dist/server.js`). There is no CI pipeline config yet.

## Repository Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — system overview, module breakdown, data flow, key design decisions
- [docs/PDS_TECH.md](docs/PDS_TECH.md) — product context and pricing plans
- [docs/MULTI_TENANT_GAPS.md](docs/MULTI_TENANT_GAPS.md) — tenancy/billing/queue gap checklist
- [docs/COGNITO_PLAN.md](docs/COGNITO_PLAN.md) — auth migration plan
- [docs/LLAMAPARSE.md](docs/LLAMAPARSE.md) — parser limits, data residency, pricing
- [docs/SECURITY.md](docs/SECURITY.md) — security practices (prompt injection, secrets, data privacy)
- [docs/SECURITY_GAPS.md](docs/SECURITY_GAPS.md) — security gap checklist (LLM injection, output validation, auth, uploads); tick items off as they're fixed
- [docs/diagrams/](docs/diagrams/) — database schema and user-flow diagrams (draw.io + PNG)
- [docs/archive/](docs/archive/) — completed plans, kept for history only
- [.claude/agents/](.claude/agents/) — project subagents: `bank-statement-generator` (synthetic PDF fixtures), `parsed-data-validator` (checks `parsedData` against the source file), `sme-instruction-drafter` (writes SME instruction text)

## Environment Variables

Copy [.env.example](.env.example) to `.env` in the project root and fill in the variables below.

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default `3000`) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_POOL_MAX` | Max `pg` pool connections per process (default `20`, `src/plugins/prisma.ts`) |
| `CORS_ORIGIN` | Comma-separated list of allowed origins. If unset, CORS allows all origins (`origin: true`) |
| `JWT_SECRET` | Required. Signs auth access/refresh tokens (`src/plugins/auth.ts`); token expiry is hardcoded to `365d` |
| `AWS_REGION` | AWS region for the S3 client used for document storage |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 credentials, read by the AWS SDK's default credential chain (not referenced in code). Needed wherever no AWS profile or IAM role is available, e.g. local dev and Render |
| `S3_BUCKET_NAME` | Required. S3 bucket documents are uploaded to |
| `S3_KEY_PREFIX` | Key prefix for stored objects (default `documents/`) |
| `LLAMA_PARSE_API_KEY` | Required for parsing PDF/image statements — LlamaParse is the only PDF/image parser; if unset (or the LlamaParse call fails), those parse jobs fail. CSV parsing does not need it |
| `ANTHROPIC_API_KEY` | Required for LLM-backed features (report narrative, agent-skill workflows, report chat). Those features degrade/error if unset |
| `ANTHROPIC_AGENT_SKILL_MODEL` | Model used for agent-skill workflow execution (default `claude-haiku-4-5-20251001`) |
| `REPORT_QUEUE_CONCURRENCY` | Report jobs claimed per poll per replica (default `3`) |
| `ANTHROPIC_REPORT_CHAT_MODEL` | Model used for the report-conversation chat feature (default `claude-haiku-4-5-20251001`) |

## Architecture

The API is built with **Fastify v5** and **Prisma v7** (PostgreSQL via `pg` + `@prisma/adapter-pg`, `prisma-client` generator). All routes are versioned under `/api/v1/`.

### Request Lifecycle

`server.ts` → `buildApp()` (app.ts) → registers plugins in order → mounts routes

Plugin registration order matters: `helmet` → `cors` → `sensible` → `multipart` → custom Prisma plugin (`prismaPlugin`) → parse-queue plugin (`parseQueuePlugin`) → report-queue plugin (`reportQueuePlugin`, decorates `server.reportQueue`) → auth plugin (`authPlugin`) → routes.

### Multi-Tenancy & Auth

`src/auth/` implements email/password auth (scrypt password hashing) with JWT access tokens plus rotating refresh tokens (`RefreshToken` model, hash stored, revocable). Routes: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`. `src/plugins/auth.ts` decorates the server with `server.authenticate`, used as an `onRequest` hook on protected routes; it derives `userId` and `organizationId` from the JWT.

`src/organizations/` (`/api/v1/organizations`) implements multi-tenant orgs. Most resources (`Document`, `Report`, SME instructions) are scoped by `organizationId`; a user with no organization still works but gets no per-org SME-instruction isolation, falling back to the global default instruction for each workflow.

### End-to-End Compliance Flow

1. Client uploads documents (CSV, PDF, or image bank statements) → `POST /api/v1/documents/upload` (direct multipart) or the pre-signed `upload-url` / `confirm` pair — both stream/store the file to S3
2. Each upload enqueues a `ParseJob`; a background worker (`server.parseQueue`) parses the file asynchronously via the parser factory and writes `Document.parsedData` + sets `Document.status = COMPLETED`
3. Client requests reports with document IDs and/or a batch ID and workflow names → `POST /api/v1/reports/generate`; the reports service validates the documents are `COMPLETED` with non-null `parsedData`
4. Each `(document, workflow)` pair is enqueued as a `ReportJob`; the report queue worker (`server.reportQueue`) claims them and the workflow runs through the LLM-driven agent-skill pipeline (`src/agent-skills/`) — see "Agent-Skill Workflow" below
5. Findings are persisted as `ComplianceCheck` records; one `Report` record is created per `(document, workflow)` pair and set to `COMPLETED` (or `FAILED` on error)
6. Clients can then converse with an LLM agent about a completed report via `src/report-conversations/`

### Adding a New Feature Module

Follow the pattern in [src/documents/](src/documents/) and [src/reports/](src/reports/):
- `routes.ts` — FastifyPluginAsync, registered via `registerRoutes` in [src/routes/index.ts](src/routes/index.ts)
- `service.ts` — business/data-access logic
- `types.ts` — TypeScript types specific to the module

Register the new plugin in [src/routes/index.ts](src/routes/index.ts) with its `/api/v1/<resource>` prefix.

### Prisma Plugin

[src/plugins/prisma.ts](src/plugins/prisma.ts) decorates the Fastify instance with `server.prisma`. It manages a `pg` connection pool and attaches a `PrismaPg` adapter. Use `request.server.prisma` inside route handlers. After editing `prisma/schema.prisma`, always run `npm run db:generate` to regenerate the client in `src/generated/prisma/`.

### File Uploads & Storage

Uploaded files are stored in **S3**, not local disk (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`). Two upload paths, both in [src/documents/](src/documents/):
- Direct multipart: `POST /api/v1/documents/upload` — [src/documents/service.ts](src/documents/service.ts) streams the file into S3 (no local buffering), validates MIME type against `ALLOWED_MIME_TYPES`, then enqueues a parse job.
- Pre-signed URL flow: `POST /api/v1/documents/upload-url` returns per-file pre-signed S3 PUT URLs (15-minute TTL); the client uploads directly to S3; `POST /api/v1/documents/:id/confirm` verifies the object exists (`HeadObjectCommand`) and enqueues parsing.

Other document endpoints: `GET /api/v1/documents/list`, `GET /api/v1/documents/:id`, `GET /api/v1/documents/:id/file` (streams from S3), `POST /api/v1/documents/:id/parse` (manual re-parse), `GET /api/v1/documents/:id/parse-status` (job status + queue position), `GET /api/v1/documents/queue/status` (aggregate queue counts).

Multipart limits (set in `app.ts`): 10 MB per file, 10 files per request.

### Parse Queue

[src/documents/parse-queue.ts](src/documents/parse-queue.ts) is a custom **Postgres-backed** job queue (no Redis/BullMQ) — the `ParseJob` model. `ParseQueueWorker.enqueue()` upserts a `QUEUED` row; a polling loop (`POLL_INTERVAL_MS = 5000`) claims batches of 20 with `SELECT ... FOR UPDATE SKIP LOCKED` (safe across multiple server replicas), parses via `parseDocument()`, and retries failed jobs up to `ParseJob.maxAttempts` (default 3) before marking `FAILED`. Registered as a Fastify plugin ([src/plugins/parse-queue.ts](src/plugins/parse-queue.ts)) decorating `server.parseQueue`; starts on `onReady` (re-queuing any jobs stuck `PROCESSING` from a prior crash) and stops on `onClose`.

### Parser Module

[src/parser/](src/parser/) is a polymorphic parsing layer. `getParser(mimeType)` returns a `ParserStrategy` or `null`. Three MIME types are implemented:

- **`text/csv`** — `CsvParser` ([src/parser/csv.ts](src/parser/csv.ts)). Parses locally via the `csv-parse` library — no LlamaParse involved, since CSV is already structured. Header alias matching (case-insensitive fuzzy column detection) handles varied bank statement formats, resolving amounts from either a single signed column or separate debit/credit columns.
- **`application/pdf`** — `PdfParser` ([src/parser/pdf.ts](src/parser/pdf.ts)). LlamaParse is the only parser — there is no local extraction or OCR fallback. If LlamaParse's markdown doesn't yield a recognizable transaction table, a generic line-based scan of the same markdown text is tried before giving up; if LlamaParse itself fails (missing `LLAMA_PARSE_API_KEY`, job error, network error), the parse throws.
- **`image/jpeg`, `image/png`, `image/webp`** — `ImageParser` ([src/parser/image.ts](src/parser/image.ts)). Same LlamaParse-only approach as PDF, with the generic line-based scan as its one fallback interpretation of the markdown.

**LlamaParse integration** ([src/parser/llama-parse.ts](src/parser/llama-parse.ts)) is a hand-rolled `fetch()` client (no SDK) against `https://api.cloud.llamaindex.ai/api/parsing`: upload → poll job status (3s interval, up to ~60s) → fetch markdown result → parse markdown tables into transactions, using balance deltas to correct debit/credit misclassification. A `Semaphore` caps concurrent LlamaParse calls to **20** (the plan's rate limit) — this is what the parse queue's `BATCH_SIZE = 20` is tuned to match. Returns `null` if `LLAMA_PARSE_API_KEY` is unset, the job fails, or a network error occurs — `PdfParser`/`ImageParser` treat that as a hard failure and throw, since there is no local fallback.

LlamaParse's own supported formats, rate limits, service limitations, and credit pricing (plus cost estimates per product plan tier) are documented in [docs/LLAMAPARSE.md](docs/LLAMAPARSE.md) — consult it before changing the parse mode, concurrency, polling timeout, or adding parsers for new MIME types.

**Data residency:** `BASE_URL` in `llama-parse.ts` is hardcoded to the North America endpoint (`api.cloud.llamaindex.ai`, AWS `us-east-1`), so UK player documents are currently processed in the US. LlamaParse also offers an EU region (`api.cloud.eu.llamaindex.ai`, Frankfurt; needs a separate EU org and API key — orgs can't migrate regions) and single-tenant/BYOC/self-hosted deployments, which the Major Player tier's "dedicated VPC & tenancy isolation" promise likely requires. See "Data Handling & Deployment" in [docs/LLAMAPARSE.md](docs/LLAMAPARSE.md) before changing the endpoint or adding per-tenant parser config.

`ALLOWED_MIME_TYPES` (upload validation, [src/documents/types.ts](src/documents/types.ts)) is broader than `PARSEABLE_MIME_TYPES` — `.xls`/`.xlsx`/`.docx` can be uploaded and stored but have no parser yet.

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

To add a new parser, implement `ParserStrategy` and register the MIME type in [src/parser/index.ts](src/parser/index.ts).

### Risk Engine Support Code

[src/risk-engine/](src/risk-engine/) no longer contains a deterministic rule engine — that code (checkpoint algorithms, workflow composers, static reference data) was removed. What remains is small shared support code consumed by the agent-skill pipeline below:

- `normalizeTransactions()` ([src/risk-engine/index.ts](src/risk-engine/index.ts)) — converts a document's `NormalizedTransaction[]` (string `amount`/`balance`) into `NumericTransaction[]` before it's fed to the LLM prompt.
- `SUPPORTED_WORKFLOWS` (same file) — the canonical `['kyc', 'sg', 'traml', 'document-integrity']` list used to validate the `workflows[]` array on `POST /api/v1/reports/generate`.
- `computeOverallScore()` ([src/risk-engine/scoring.ts](src/risk-engine/scoring.ts)) — aggregates a workflow's `RiskFinding[]` into a single 0–100 `overallScore` (max finding score + 10% of the sum of the others, capped at 100). Called by the agent-skill runner after validating the model's output.
- `RiskFinding`/`WorkflowResult`/`RiskReport`/`NumericTransaction` ([src/risk-engine/types.ts](src/risk-engine/types.ts)) — the shared result shape produced by agent-skill runs and persisted into `Report.content`/`ComplianceCheck`.

### Agent-Skill Workflow

All report generation runs through the LLM-driven agent-skill pipeline — there is no alternative deterministic mode. [src/agent-skills/runner.ts](src/agent-skills/runner.ts) (`runAgentSkillWorkflow`):
1. Resolves the active `AgentSkillInstruction` for the workflow — org-scoped active instruction first, else a global active one, else a hardcoded `DEFAULT_INSTRUCTIONS` fallback per workflow (kyc/sg/traml/document-integrity), else a generic string. SME-authored instructions are managed via [src/sme-instructions/](src/sme-instructions/) (`GET/POST /api/v1/workflows/:workflow/instructions`, versioned, activate/deactivate).
2. Builds a prompt ([src/agent-skills/prompt-builder.ts](src/agent-skills/prompt-builder.ts)) instructing the model to complete its full analysis before committing to `triggered`/`score`/`severity`, and to return JSON matching a Zod/JSON-Schema contract (`{ findings: [{ checkpoint, triggered, severity, score, reason, evidenceIndices }] }`). There is no separate checkpoint catalog — the SME instruction text itself is the only source of "known" checkpoint topics/slugs; the model is told to use those slugs when a finding matches, and to invent a new `ai-`-prefixed slug otherwise.
3. Calls `generateAgentSkillFindings()` ([src/llm/agent-skill.ts](src/llm/agent-skill.ts)) — Anthropic `messages.create` with structured JSON-schema output, model from `ANTHROPIC_AGENT_SKILL_MODEL`. Retries up to 3 times with exponential backoff on validation failure or API error.
4. Every attempt is logged to the audit trail below before mapping `evidenceIndices` back to real transactions and computing `overallScore` (`src/risk-engine/scoring.ts`).

Any numeric limits or thresholds a checkpoint needs (e.g. a CTR reporting limit, a drain-ratio percentage) are expressed as plain text inside the SME instruction content — there is no separate structured threshold-configuration system. Editing a limit means creating a new versioned `AgentSkillInstruction` via [src/sme-instructions/](src/sme-instructions/), not calling a config endpoint.

### Agent Execution Audit Trail

Every agent-skill LLM call is recorded for audit: `WorkflowExecution` (one per workflow run) → `AgentConversation` (1:1 with the execution) → `AgentExecution` (one per attempt, tracks `promptTokens`/`completionTokens`/`latencyMs`/`status`) → `AgentMessage` (one row per SYSTEM/USER/ASSISTANT message, including rejected/invalid attempts). Queryable via [src/workflow-executions/](src/workflow-executions/): `GET /api/v1/reports/:id/workflow-executions`, `GET /api/v1/workflow-executions` (org-wide, cursor-paginated, filterable), `GET /api/v1/workflow-executions/:id`, `GET /api/v1/workflow-executions/:id/conversation`, `GET /api/v1/agent-executions/:id`.

This is distinct from the user-facing report chat below — `AgentMessage` is the internal LLM audit log; `ReportConversationMessage` is the user-visible chat transcript.

### Report Conversations

[src/report-conversations/](src/report-conversations/) lets a user converse with an LLM agent about a completed report. Endpoints (mounted under `/api/v1/reports`, all require auth):
- `POST /:id/conversations` — start a conversation (report must be `COMPLETED`)
- `POST /:id/conversations/:conversationId/messages` — send a message (`{ message: string }`, 1–2000 chars)
- `GET /:id/conversations/:conversationId` — full message history
- `GET /:id/conversations` — list conversations for a report

[src/report-conversations/context-builder.ts](src/report-conversations/context-builder.ts) builds the system prompt from report metadata, the `ReportSummary`, per-workflow `RiskFinding`s (top-5 evidence transactions each), the report narrative, `ComplianceCheck` rows, and a summary of the workflow execution audit trail (metadata only, no raw message bodies). The prompt instructs the model to answer only from report data and to resist prompt injection from the user message. `sendMessage()` keeps the last 10 turns (20 messages) as history, calls Anthropic (`ANTHROPIC_REPORT_CHAT_MODEL`) via [src/llm/report-conversation.ts](src/llm/report-conversation.ts), and persists the user + assistant messages in one transaction.

### Reports Module

[src/reports/service.ts](src/reports/service.ts) orchestrates the full pipeline: document resolution → agent-skill analysis → persistence. Key behaviors:

- Validates `workflows` against `SUPPORTED_WORKFLOWS` before doing any work
- Accepts `document_ids`, `batch_id`, or both (set union); documents must have `status === 'COMPLETED'` and non-null `parsedData`
- Creates a `Report` row per `(document, workflow)` pair up front (`status: GENERATING`) so the client has something to poll for immediately, then enqueues a durable `ReportJob` per pair, since agent-skill LLM calls can exceed a typical proxy's request timeout
- [src/reports/report-queue.ts](src/reports/report-queue.ts) is a Postgres-backed queue mirroring the parse queue (`SELECT ... FOR UPDATE SKIP LOCKED`, 5s poll, batch size `REPORT_QUEUE_CONCURRENCY` default 3, retries up to `maxAttempts`, crash recovery on start). Jobs are claimed **round-robin across tenants**, not strictly FIFO: each tenant's oldest queued job ranks first, so one org's large backlog can't starve another org's job. Tenant = `Report.organizationId`, falling back to `userId` for org-less users
- Sets `Report.status = COMPLETED` on success, `FAILED` on any thrown error
- Stores workflow results and a `ReportSummary` as JSON inside `Report.content`
- Each `RiskFinding` is also persisted as a `ComplianceCheck` row (rule = checkpoint name, passed = `!triggered`, details = JSON)

### Database Schema

| Model | Purpose |
|---|---|
| `Organization` | Multi-tenant root; owns users, reports, documents, and per-org SME instructions |
| `User` | Account (email/password); optionally belongs to an `Organization`; owns `Report`s, `RefreshToken`s, `AgentSkillInstruction`s, `ReportConversation`s |
| `RefreshToken` | Rotating JWT refresh token (hash stored), revocable |
| `DocumentBatch` | Named group of `Document`s, referenceable by `batch_id` in report generation |
| `Document` | Uploaded file metadata; `status`: `PROCESSING` → `COMPLETED`/`FAILED`; `parsedData: Json?` holds the normalized transactions; 1:1 with `ParseJob` |
| `ParseJob` | Backs the parse queue; `status`: `QUEUED` → `PROCESSING` → `COMPLETED`/`FAILED`; tracks `attempts`/`maxAttempts` |
| `ReportJob` | Backs the report queue; 1:1 with a `Report` (`reportId` unique), plus `documentId`/`workflow`; `status`: `QUEUED` → `PROCESSING` → `COMPLETED`/`FAILED`; tracks `attempts`/`maxAttempts` |
| `Workflow` | Catalog of workflows (`kyc`, `sg`, `traml`, `document-integrity`); slug/name/description/enabled only — no per-checkpoint sub-catalog |
| `AgentSkillInstruction` | Versioned SME-authored instruction text fed into agent-skill prompts, optionally org-scoped, with an active/inactive flag |
| `Report` | Compliance report for one `(document, workflow)` pair; `status`: `GENERATING` → `COMPLETED`/`FAILED`; JSON `content` holds results + summary |
| `ComplianceCheck` | One row per `RiskFinding`; `rule` = checkpoint name, `details` = JSON with scores |
| `WorkflowExecution` | One per workflow run; links to its `Report` and its `AgentConversation` |
| `AgentConversation` | 1:1 with a `WorkflowExecution`; groups `AgentExecution`s (LLM call attempts) |
| `AgentExecution` | One LLM call attempt; tracks tokens, latency, status; has ordered `AgentMessage`s |
| `AgentMessage` | One SYSTEM/USER/ASSISTANT message in the internal agent audit trail |
| `ReportConversation` | A user-facing chat thread about a completed `Report` |
| `ReportConversationMessage` | One USER/ASSISTANT message in a report conversation |

All primary keys are UUIDs. Notable cascades: `Report` → `ComplianceCheck`, `WorkflowExecution`, `ReportConversation`, `ReportJob` (cascade); `Document` → `ReportJob` (cascade); `User` → `Report` (`SetNull`); `AgentConversation` → `AgentExecution` → `AgentMessage` (cascade).

### Logging

Fastify's built-in logger is used throughout. Development uses `pino-pretty` with debug-level output; production uses JSON at info level. Use `request.log` in route handlers and `server.log` elsewhere.
