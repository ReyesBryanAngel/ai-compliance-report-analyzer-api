# Architecture

## 1. System Overview

**ai-compliance-report-analyzer-api** is a multi-tenant backend service that turns raw bank/e-wallet statements (CSV, PDF, or scanned images) into structured compliance risk reports. It solves the problem of manually reviewing customer transaction histories for AML/KYC/fraud red flags (unexplained income, gambling activity, rapid fund movement, circular transactions, document tampering, sanctions exposure, etc.) by parsing uploaded statements into a normalized transaction format and running that data through an LLM-driven analysis agent, per organization, per workflow.

Core technologies:

- **Runtime/Language**: Node.js + TypeScript
- **Web framework**: Fastify v5 (plugin-based, schema-validated routes)
- **ORM/Database**: Prisma v7 (`prisma-client` generator) over PostgreSQL, via the `pg` driver and `@prisma/adapter-pg`
- **Object storage**: AWS S3 (`@aws-sdk/client-s3`, `lib-storage`, `s3-request-presigner`) — uploaded files are never persisted to local disk
- **Job queues**: Two custom Postgres-backed queues (`ParseJob` and `ReportJob` tables, each with a `SELECT ... FOR UPDATE SKIP LOCKED` polling loop) — no Redis/BullMQ dependency
- **Document parsing**: LlamaParse (cloud API) is the sole parser for PDF and image statements; `csv-parse` handles CSV locally
- **LLM**: Anthropic (`@anthropic-ai/sdk`) for the agent-skill analysis pipeline, report narrative generation, and the report chat feature
- **Auth**: `@fastify/jwt` (access + rotating refresh tokens), `scrypt` password hashing
- **Validation**: Zod (LLM output schemas) and Fastify's built-in JSON-schema route validation

## 2. Directory Structure & Entry Points

```text
ai-compliance-report-analyzer-api/
├── src/
│   ├── server.ts               # ENTRY POINT — loads .env, calls buildApp(), starts HTTP listener
│   ├── app.ts                  # Fastify app factory — registers plugins & routes in order
│   │
│   ├── plugins/                # Fastify decorators (cross-cutting infrastructure)
│   │   ├── prisma.ts           #   decorates server.prisma (pg Pool + PrismaPg adapter)
│   │   ├── auth.ts             #   decorates server.authenticate (JWT verification hook)
│   │   ├── parse-queue.ts      #   decorates server.parseQueue (starts/stops the parse worker)
│   │   └── report-queue.ts     #   decorates server.reportQueue (starts/stops the report worker)
│   │
│   ├── routes/
│   │   ├── index.ts            # registerRoutes() — mounts every feature module under /api/v1
│   │   └── health.ts           # GET /api/v1/health
│   │
│   ├── auth/                   # Register / login / refresh-token endpoints + JWT/scrypt logic
│   ├── organizations/          # Multi-tenant org CRUD
│   │
│   ├── documents/              # Upload (multipart + pre-signed S3), listing, streaming, parse triggers
│   │   ├── routes.ts
│   │   ├── service.ts          #   S3 read/write, DB writes, parseDocument() orchestration
│   │   ├── parse-queue.ts      #   ParseQueueWorker: Postgres polling job queue
│   │   └── types.ts
│   │
│   ├── parser/                 # Polymorphic file → NormalizedTransaction[] parsing layer
│   │   ├── index.ts            #   getParser(mimeType) factory
│   │   ├── csv.ts / pdf.ts / image.ts   # per-MIME-type ParserStrategy implementations
│   │   ├── llama-parse.ts      #   LlamaParse REST API client — sole parser for PDF/image
│   │   ├── normalize.ts        #   date/amount/channel/category normalization helpers
│   │   └── text-line-parser.ts #   last-resort generic line parser
│   │
│   ├── risk-engine/            # Shared support code for agent-skill analysis (no execution engine)
│   │   ├── index.ts            #   normalizeTransactions(), SUPPORTED_WORKFLOWS
│   │   ├── scoring.ts          #   computeOverallScore() — aggregates findings into overallScore
│   │   └── types.ts            #   RiskFinding / WorkflowResult / RiskReport / NumericTransaction
│   │
│   ├── agent-skills/           # LLM-driven compliance analysis — the only analysis mode
│   │   ├── runner.ts           #   runAgentSkillWorkflow() — prompt build → LLM call → validate → persist
│   │   ├── prompt-builder.ts   #   builds system/user prompts + DEFAULT_INSTRUCTIONS per workflow
│   │   ├── schema.ts           #   Zod schema the model's JSON output must satisfy
│   │   └── errors.ts
│   │
│   ├── sme-instructions/       # CRUD for versioned SME-authored agent-skill instructions
│   ├── workflows/               # Workflow catalog endpoints (slug/name/description; read-only)
│   │
│   ├── reports/                # Orchestrates the end-to-end pipeline; Report CRUD
│   │   ├── service.ts          #   generateReport() (validate + enqueue) and processReport() (analyze + persist)
│   │   ├── report-queue.ts     #   ReportQueueWorker: Postgres polling job queue, round-robin across tenants
│   │   ├── routes.ts           #   POST /api/v1/reports/generate, GET /:id, GET /list
│   │   └── types.ts
│   │
│   ├── workflow-executions/    # Read-only audit trail API (WorkflowExecution/AgentConversation/...)
│   ├── report-conversations/   # User-facing LLM chat about a completed report
│   │   └── context-builder.ts  #   builds the chat system prompt from report data
│   │
│   ├── llm/                    # Thin Anthropic SDK wrappers (agent-skill calls, narrative, chat)
│   ├── types/                  # Shared/global TS types (incl. FastifySchema augmentation)
│   └── generated/prisma/       # Prisma client output (generated, not hand-written)
│
├── prisma/
│   ├── schema.prisma           # Full DB schema (source of truth for models below)
│   ├── seed.ts                 # npm run db:seed
│   └── migrations/
│
├── scripts/
│   ├── render-statement-pdf.mjs        # HTML → PDF helper used by the bank-statement-generator agent
│   ├── generate-benchmark-samples.mjs  # builds CSV/image samples for the benchmark
│   └── benchmark-upload.mjs            # times upload → parse completion against a running server
│
├── docs/                       # Product context, tenancy & security gap checklists, Cognito plan, LlamaParse, diagrams
│   └── archive/                #   completed plans, kept for history only
├── .claude/agents/             # Claude Code subagents (statement generator, parsed-data validator, SME drafter)
│
├── CLAUDE.md                   # Working guide for Claude Code (commands, env vars, module details)
├── .env.example                # Template for .env
├── postman_collection.json     # API request collection
├── prisma.config.ts
├── render.yaml                 # Render.com deployment config
├── package.json
└── tsconfig.json
```

**Entry point**: [src/server.ts](src/server.ts) — loads environment variables via `dotenv`, calls `buildApp()` from [src/app.ts](src/app.ts) to construct the Fastify instance, and starts listening on `PORT`/`HOST`. `buildApp()` is itself the real composition root: it registers `helmet` → `cors` → `sensible` → `multipart` → `prismaPlugin` → `parseQueuePlugin` → `reportQueuePlugin` → `authPlugin`, then calls `registerRoutes()` ([src/routes/index.ts](src/routes/index.ts)), which mounts every feature module's routes under its `/api/v1/...` prefix. This ordering matters: routes that use `server.prisma`, `server.parseQueue`, `server.reportQueue`, or `server.authenticate` depend on the plugins registered before them.

## 3. Module Breakdown

| Module | Responsibility |
|---|---|
| [src/plugins/](src/plugins/) | Fastify decorators providing shared infrastructure to every route: `server.prisma` (DB client), `server.authenticate` (JWT guard), `server.parseQueue` and `server.reportQueue` (background worker handles). Each plugin declares its own `FastifyInstance` type augmentation. |
| [src/auth/](src/auth/) | Email/password registration and login, scrypt password hashing, JWT access-token issuance, rotating/revocable refresh tokens (`RefreshToken` model). |
| [src/organizations/](src/organizations/) | Multi-tenant organization CRUD. Most other resources are scoped by `organizationId` derived from the JWT. |
| [src/documents/](src/documents/) | Document lifecycle: multipart upload straight to S3, pre-signed-URL upload flow, listing, file streaming, manual re-parse, and parse-status/queue-status endpoints. Owns the parse queue worker implementation. |
| [src/parser/](src/parser/) | Strategy-pattern parsing layer. `getParser(mimeType)` selects a `CsvParser`, `PdfParser`, or `ImageParser`; each ultimately emits `NormalizedTransaction[]`. CSV is parsed locally; PDF and image statements are parsed exclusively via the LlamaParse cloud API, with a generic line-based scan of the same markdown as the only fallback interpretation (not a second extraction method). |
| [src/risk-engine/](src/risk-engine/) | No longer an execution engine — just shared support code the agent-skill pipeline depends on: transaction normalization, overall-score aggregation, and the `RiskFinding`/`WorkflowResult` types. |
| [src/agent-skills/](src/agent-skills/) | The compliance analysis engine. Builds a prompt from the SME instruction text alone (no separate checkpoint catalog — the instruction text is the only source of "known" finding topics/slugs), calls Anthropic with a JSON-schema contract, validates/retries, and produces a `WorkflowResult`. Persists every attempt to the audit trail. |
| [src/sme-instructions/](src/sme-instructions/) | Versioned CRUD for the SME-authored instruction text fed into agent-skill prompts, org-scoped or global, with an activate/deactivate flag. |
| [src/workflows/](src/workflows/) | Read endpoints for the workflow catalog (slug/name/description/enabled) — no per-checkpoint sub-resource. |
| [src/reports/](src/reports/) | The orchestration layer: `generateReport()` resolves documents, creates `GENERATING` report rows and enqueues a `ReportJob` per `(document, workflow)` pair; the report queue worker then calls `processReport()`, which runs agent-skill analysis, persists `Report`/`ComplianceCheck` rows, and generates an LLM narrative. Owns the report queue worker implementation. Also exposes report read/list endpoints. |
| [src/workflow-executions/](src/workflow-executions/) | Read-only audit-trail API over `WorkflowExecution` → `AgentConversation` → `AgentExecution` → `AgentMessage`, for inspecting exactly what was sent to/received from the LLM on every agent-skill run. |
| [src/report-conversations/](src/report-conversations/) | User-facing chat about a completed report. `context-builder.ts` assembles a system prompt from report data (summary, findings, narrative, audit metadata) so the model answers only from that report's data. |
| [src/llm/](src/llm/) | Thin Anthropic SDK wrapper functions: `generateAgentSkillFindings` (agent-skill calls), `generateNarrative` (report narrative text), and the report-conversation chat call. |
| [src/types/](src/types/) | Shared TypeScript types, including the `FastifySchema` augmentation (`tags`, `summary`, etc.). The `FastifyInstance` decorators (`prisma`, `authenticate`, `parseQueue`, `reportQueue`) are declared in their own plugin files under `src/plugins/`. |
| [prisma/](prisma/) | `schema.prisma` (single source of truth for the data model), migrations, and the seed script. |

## 4. Data Flow & Lifecycle

### 4.1 Document ingestion

1. **Upload** — a client calls `POST /api/v1/documents/upload` (direct multipart, streamed straight into S3 via `@aws-sdk/lib-storage`, no local buffering) or requests a pre-signed URL via `POST /api/v1/documents/upload-url`, uploads directly to S3, then confirms with `POST /api/v1/documents/:id/confirm` (which `HeadObjectCommand`s the object to verify it landed).
2. Either path creates a `Document` row (`status: PROCESSING`) and calls `server.parseQueue.enqueue(documentId, prisma)`, which **upserts** a `ParseJob` row (`status: QUEUED`) and wakes the worker's polling loop.
3. **Background parsing** — [ParseQueueWorker](src/documents/parse-queue.ts) runs a loop (5s poll interval) that, inside a single DB transaction, claims up to 20 `QUEUED` jobs with `SELECT ... FOR UPDATE SKIP LOCKED` (so multiple server replicas never double-process a job) and flips them to `PROCESSING`.
4. For each claimed job, `parseDocument()` ([src/documents/service.ts](src/documents/service.ts)) fetches the file's MIME type, resolves a `ParserStrategy` via `getParser()`, and runs it:
   - **CSV**: parsed locally (`csv-parse`) — header-alias fuzzy column matching, resolves debit/credit or single signed-amount columns.
   - **PDF**: LlamaParse only — uploads the file, polls for the markdown result, then parses its tables. If the markdown has no recognizable table, a generic line-based scan of the same markdown is tried. If LlamaParse itself fails (`LLAMA_PARSE_API_KEY` unset, job error, network error), the parse throws — there is no local extraction or OCR fallback.
   - **Image**: same LlamaParse-only approach as PDF.
5. The parser output is normalized (`src/parser/normalize.ts`) into `NormalizedTransaction[]` (ISO dates, positive `amount` + `direction`, detected `channel`/`category`) and written to `Document.parsedData`; `Document.status` becomes `COMPLETED` (or `FAILED`, with the error also written back to `Document`/`ParseJob`).
6. On success the `ParseJob` is marked `COMPLETED`; on failure it's retried (re-queued) up to `maxAttempts` (default 3) before being marked `FAILED`. On server restart, any job stuck `PROCESSING` from a crash is re-queued in `worker.start()`.

### 4.2 Report generation

1. Client calls `POST /api/v1/reports/generate` with `document_ids` and/or `batch_id` plus a `workflows[]` list. `server.authenticate` (an `onRequest` hook) verifies the JWT and populates `request.user` (`{ sub, organizationId, email }`).
2. [reports/service.ts `generateReport()`](src/reports/service.ts) validates the requested workflows against `SUPPORTED_WORKFLOWS`, resolves the document ID set (explicit IDs ∪ batch members), and fetches those `Document` rows scoped to the caller's `organizationId` — any document that isn't `COMPLETED` or has null `parsedData` fails the request (`NOT_READY`).
3. The service builds one `(document, workflow)` pair per combination. A `Report` row is created immediately for each pair with `status: GENERATING` (`createReportShell()`) so the client has something to poll for right away. Each pair is then enqueued as a durable `ReportJob` row via `server.reportQueue.enqueue()`, and the response returns as soon as all shells and jobs exist. Queuing is deliberate: agent-skill LLM calls can take longer than a typical proxy's request timeout, so the HTTP response must not block on them, and a DB-backed queue survives a server restart.
4. **Background analysis** — [ReportQueueWorker](src/reports/report-queue.ts) polls every 5s and claims up to `REPORT_QUEUE_CONCURRENCY` (default 3) `QUEUED` jobs per poll with `SELECT ... FOR UPDATE SKIP LOCKED`. Claiming is round-robin across tenants rather than strictly FIFO: each tenant's oldest queued job ranks first, so one org's large backlog can't starve another's (tenant = `Report.organizationId`, else `userId`, else the report itself). Failed jobs are re-queued up to `maxAttempts` (default 3) before being marked `FAILED`, and jobs stuck `PROCESSING` after a crash are re-queued on startup. For each claimed job the worker loads the `Report` and `Document` and calls `processReport()`:
   - `runAgentSkillWorkflow()` resolves the active instruction (org-scoped → global → hardcoded `DEFAULT_INSTRUCTIONS` fallback), builds a system/user prompt from that instruction text and the transaction data (no separate checkpoint catalog lookup), and calls Anthropic (`generateAgentSkillFindings`) with a Zod/JSON-schema contract. Every attempt (up to 3, exponential backoff) is written to `WorkflowExecution` → `AgentConversation` → `AgentExecution` → `AgentMessage` **before and after** the call, so both successful and rejected/invalid model outputs are auditable. `evidenceIndices` from the model are mapped back to real `NormalizedTransaction` objects and `overallScore` is computed via `computeOverallScore()` ([src/risk-engine/scoring.ts](src/risk-engine/scoring.ts)).
   - Each `RiskFinding` in the resulting `WorkflowResult` is persisted as a `ComplianceCheck` row (`rule` = checkpoint slug, `passed = !triggered`, `details` = JSON of severity/score/reason).
   - `generateNarrative()` ([src/llm/service.ts](src/llm/service.ts)) produces an LLM-written prose summary of the findings.
   - The `Report.content` JSON column is updated with `{ summary, riskReport, narrative, documentNames, batches }` and `Report.status` flips to `COMPLETED` (or `FAILED`, on any thrown error, with the partial `Report` row kept for visibility).
5. The HTTP response (sent back at step 3) is a simple `{ code, status, message }` acknowledgement; clients poll `GET /api/v1/reports/:id` or `GET /api/v1/reports/list` to retrieve the persisted results.

Any numeric limit a checkpoint needs (e.g. a CTR reporting limit) lives as plain text inside the SME instruction content, not in a separate structured threshold-configuration table — there is no `OrgThresholdConfig`/`OrgCheckpointOverride`/`OrgWorkflowConfig` in this system. There was previously a deterministic "CHECKPOINTS" execution mode selectable per organization per workflow; it has been fully removed (code, DB models, and API routes) and agent-skill analysis is now the only path.

### 4.3 Report conversation (chat)

1. `POST /api/v1/reports/:id/conversations` starts a `ReportConversation` (report must be `COMPLETED`).
2. `POST /api/v1/reports/:id/conversations/:conversationId/messages` — [context-builder.ts](src/report-conversations/context-builder.ts) assembles a system prompt from the report's `ReportSummary`, per-workflow `RiskFinding`s (top-5 evidence transactions each), the narrative, `ComplianceCheck` rows, and a metadata-only summary of the agent-skill audit trail (never raw `AgentMessage` bodies). The last 10 turns (20 messages) of prior conversation are included as history. `sendMessage()` ([src/llm/report-conversation.ts](src/llm/report-conversation.ts)) calls Anthropic and persists both the user and assistant message in one DB transaction. The prompt explicitly instructs the model to answer only from report data and resist prompt injection originating in the user's message.

### 4.4 Response & error handling path

Every route runs under Fastify's built-in JSON-schema request/response validation (declared per-route in `routes.ts` files). There is no single global `setErrorHandler`; instead, handlers use `@fastify/sensible`'s reply helpers (`reply.notFound()`, `reply.badRequest()`, `reply.unauthorized()`) for expected failure cases (e.g. document not found, no parser for a MIME type, invalid/missing JWT) and otherwise let unexpected exceptions propagate to Fastify's default error handler, which logs via the request/server logger and returns a 500. Domain-level errors from the `reports` pipeline are thrown as `Error` objects tagged with a `code` property (`NOT_FOUND`, `NOT_READY`, `VALIDATION`, `UNSUPPORTED_WORKFLOW`) for the route layer to branch on.

## 5. Key Architectural Decisions

- **Layered/modular-monolith, not microservices.** Every feature lives in one Node process behind a single Fastify app, organized as self-contained vertical modules (`routes.ts` / `service.ts` / `types.ts` per folder) rather than by technical layer (e.g. no repository interfaces or dependency-injection container) — each module talks to `request.server.prisma` directly.
- **Strategy pattern for parsing.** `ParserStrategy` ([src/parser/types.ts](src/parser/types.ts)) is implemented per MIME type (`CsvParser`, `PdfParser`, `ImageParser`) and selected by a factory (`getParser`), so adding a new file format requires only a new strategy + one line in `parser/index.ts`.
- **LLM-only analysis behind a stable result shape.** `runAgentSkillWorkflow()` always produces the same `WorkflowResult` shape (`{ workflow, overallScore, findings: RiskFinding[] }`) regardless of which workflow ran, so `reports/service.ts`, `ComplianceCheck` persistence, report narrative generation, and report-conversation context-building don't need to know or care that the analysis is LLM-driven — they just consume the shape. A prior version of this system supported a second, deterministic "CHECKPOINTS" execution mode toggled per organization per workflow (`OrgWorkflowConfig`); that mode, its risk-engine implementation, and its config API have since been removed entirely, leaving agent-skill as the only analysis path.
- **New checkpoints/rules are prompt changes, not code changes.** Since there's no deterministic engine, adding or tuning a risk rule means editing the SME instruction text ([src/sme-instructions/](src/sme-instructions/)) rather than writing a new function — including any numeric thresholds a rule depends on.
- **Postgres as the only infrastructure dependency for queuing.** Rather than adding Redis/BullMQ, both the parse queue and the report queue are implemented directly on Postgres using `SELECT ... FOR UPDATE SKIP LOCKED`, making them safe under multiple server replicas with no extra moving parts. The report queue claims jobs round-robin across tenants so one org's backlog can't starve another's; the parse queue is still plain FIFO (see item 12 in [docs/MULTI_TENANT_GAPS.md](docs/MULTI_TENANT_GAPS.md)). Both workers currently run inside the API process.
- **Full LLM audit trail as a first-class data model**, separate from the user-facing chat: `WorkflowExecution → AgentConversation → AgentExecution → AgentMessage` records every prompt/response (including rejected/invalid attempts) for the agent-skill pipeline, independent from `ReportConversation → ReportConversationMessage`, which is the user-visible chat transcript.
- **Multi-tenancy via nullable `organizationId` scoping, not separate schemas/databases.** Nearly every query conditionally applies `organizationId` — a user with no organization still functions, but without per-org SME-instruction isolation (falls back to the global default instruction).
- **State**: No server-side session or in-memory application state beyond the parse- and report-queue workers' polling loops and an in-process semaphore capping concurrent LlamaParse calls at 20. All durable state lives in Postgres (via Prisma) or S3 (file bytes); the API is horizontally scalable across replicas by design (hence the `SKIP LOCKED` queue claim).
- **Authentication**: Stateless JWT access tokens (`@fastify/jwt`, `365d` expiry) plus rotating, hash-stored, revocable refresh tokens (`RefreshToken` model). `server.authenticate` is applied per-route as an `onRequest` hook (not global), and decodes `{ sub, organizationId, email }` onto `request.user` for downstream scoping.
- **Error handling**: No centralized error-mapping middleware; each route catches expected domain errors and maps them to `@fastify/sensible` HTTP helpers, while unexpected errors bubble to Fastify's default handler and are logged via the built-in Pino logger (`pino-pretty` in development, structured JSON in production).
