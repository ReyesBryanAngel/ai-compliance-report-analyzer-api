# Plan: Remove Checkpoint Mode from Report Generation

## Status: ✅ Completed

All phases below were executed and merged. Report generation now runs exclusively through `AGENT_SKILL` — there is no `CHECKPOINTS` code path, config surface, or DB schema left anywhere in the codebase. Verified against this repo's state as of 2026-09-17:

- **Code**: committed as `5c6d156` — "refactor: remove deterministic checkpoints and js built in parser tool" — merged via PR #2 (`refactor/remove-checkpoint-based-report-and-js-parser-tools`, merge commit `149ad5f`) into `main`.
- **Schema/DB migration**: `prisma/migrations/20260913023305_remove_checkpoint_mode` exists and is recorded as applied in `_prisma_migrations` on the local dev database (`finished_at: 2026-09-13T05:02:17Z`). Confirmed directly against the live DB (not just the schema file): `org_workflow_configs`, `org_checkpoint_overrides`, and `org_threshold_configs` tables no longer exist; `checkpoints.enabled` and `workflow_executions.mode` columns are gone; the `WorkflowMode` enum type no longer exists.
- **Pre-flight audit result** (§4): at the time of removal, `OrgWorkflowConfig`/override/threshold tables were empty and all 13 existing `WorkflowExecution` rows already had `mode = 'AGENT_SKILL'` — so the drop needed no data-migration/backfill step, only the schema change itself.
- **Decisions (§6) resolved**: Decision 2 went with **Drop** — `WorkflowExecution.mode` and the `mode` filter were removed from `src/workflow-executions/{types,service,routes}.ts`, not just left in place.
- **`ARCHITECTURE.md`**: rewritten to remove all CHECKPOINTS-mode/dual-strategy language; present and current on disk (this file is gitignored, so it has no commit of its own — verify it's carried over on any fresh clone/CI checkout, since git won't do that for you).
- **`CLAUDE.md`**: ⚠️ **outstanding** — the doc rewrite for this removal (Agent-Skill Workflow section, Reports Module, Database Schema table, env var table) was made but only exists in a local `git stash` (`stash@{0}`, based on commit `149ad5f`) on the machine where it was written. The version currently committed to `main`/this branch's `CLAUDE.md` still describes the old pre-agent-skill, pre-multi-tenant architecture (single `kyc` workflow, local disk uploads, no auth/S3/orgs) — it predates even the original agent-skill work and was never updated in this branch's history. This is a pre-existing documentation gap unrelated to the checkpoint-mode changes themselves, but worth fixing in a follow-up: either pop that stash and reconcile it with the current `CLAUDE.md`, or write `CLAUDE.md` fresh against the current codebase.
- **Separately** (not part of this plan, but same removal commit): the local PDF/image parsing fallback chain (`pdfjs-dist`, `tesseract.js`, `node-canvas`) was also removed in the same effort, leaving LlamaParse as the sole PDF/image parser; `csv-parse` was kept for local CSV parsing.

The rest of this document is kept as-is below for historical reference — it was the plan followed to get here.

## 1. Background

Report generation currently supports two execution modes per `(organization, workflow)`, chosen via `OrgWorkflowConfig.mode`:

- **`CHECKPOINTS`** — the deterministic risk engine (`src/risk-engine/`) runs hand-coded checkpoint functions against transactions.
- **`AGENT_SKILL`** — an LLM (Anthropic) performs the analysis, per `src/agent-skills/`. **This is already the default** for every org and for users with no organization (`resolveWorkflowModes()` in [src/reports/service.ts](src/reports/service.ts) falls back to `AGENT_SKILL` whenever no config row exists).

The goal is to delete the `CHECKPOINTS` code path entirely and make `AGENT_SKILL` the only mode, without breaking anything `AGENT_SKILL` depends on.

## 2. Critical finding: shared code that must NOT be deleted

Several things live under `risk-engine/` or look "checkpoint-related" but are actually load-bearing for `AGENT_SKILL` mode too:

| Thing | Why it must survive |
|---|---|
| `src/risk-engine/types.ts` (`RiskFinding`, `WorkflowResult`, `NumericTransaction`, `RiskReport`) | `AGENT_SKILL`'s `runAgentSkillWorkflow()` returns a `WorkflowResult` built from these exact types. Reports, workflow-executions, and report-conversations all consume `WorkflowResult`/`RiskFinding`. |
| `src/risk-engine/scoring.ts` (`computeOverallScore`) | Called directly by [src/agent-skills/runner.ts:234](src/agent-skills/runner.ts#L234) to score LLM findings. |
| `normalizeTransactions()` (currently in `src/risk-engine/index.ts`) | Called by [src/reports/service.ts:132](src/reports/service.ts#L132) before every `AGENT_SKILL` run to convert string amounts to numbers. Not checkpoint-specific — just a data-shape adapter. |
| `Workflow` and `Checkpoint` Prisma models (slug/name/description) | Used as a **catalog**, not an execution engine: `runAgentSkillWorkflow()` queries `prisma.checkpoint.findMany(...)` to build the "Checkpoint Catalog" section of the LLM prompt ([src/agent-skills/prompt-builder.ts:39](src/agent-skills/prompt-builder.ts#L39)), and `prisma/seed.ts` uses the same list to generate default SME instructions. Deleting these tables breaks agent-skill prompts and the seed script. |
| `SUPPORTED_WORKFLOWS` constant (currently exported from `risk-engine/workflows/index.ts`) | Used to validate the `workflows` array in every report-generation request, and by `workflow-config`/`thresholds` routes. Needs a new home once the `workflows/` risk-engine folder is deleted. |

Everything else under `src/risk-engine/checkpoints/`, `src/risk-engine/workflows/{kyc,sg,traml,document-integrity}.ts`, and `src/risk-engine/data/` is **execution logic exclusive to `CHECKPOINTS` mode** and is safe to delete.

## 3. Full inventory

### 3.1 Delete entirely

- `src/risk-engine/checkpoints/*.ts` (22 files — every deterministic rule, e.g. `recurring-salary.ts`, `gambling-debits.ts`, `sanctions-watchlist.ts`, etc.)
- `src/risk-engine/workflows/kyc.ts`, `sg.ts`, `traml.ts`, `document-integrity.ts` (the `runKyc`/`runSg`/`runTraml`/`runDocumentIntegrity` composers and their `*Thresholds` types)
- `src/risk-engine/data/` (`currency-country-map.ts`, `high-risk-countries.ts`, `sanctions-list.ts` — only consumed by the checkpoints above)
- `src/thresholds/` (`routes.ts`, `service.ts`, `types.ts`) — its sole purpose is configuring `greenMax`/`amberMax`/`params` for the risk engine
- `src/workflow-config/` (`routes.ts`, `service.ts`, `types.ts`) — mode selection has no purpose once only one mode exists
- The `PATCH /:workflow/checkpoints/:checkpoint` handler in `src/workflows/routes.ts` (enable/disable was only ever consumed by `resolveEnabledCheckpoints()` for the risk engine)

### 3.2 Modify (strip CHECKPOINTS branch, keep the rest)

- **[src/reports/service.ts](src/reports/service.ts)**: delete `resolveEnabledCheckpoints()`, `resolveWorkflowModes()`, the `enabledCheckpoints`/`thresholds` computation in `generateReport()`, and the `if/else` in `generateSingleReport()` — always call `runAgentSkillWorkflow()`. Drop the now-unused `workflowMode` parameter.
- **[src/risk-engine/index.ts](src/risk-engine/index.ts)**: keep only `normalizeTransactions()` and the re-exported types (`RiskFinding`, `RiskReport`, `WorkflowResult`, `NumericTransaction`); delete `runRiskEngine()`, `normalizeAmounts()`, and the `RiskEngineThresholds`/`RiskEngineOptions` types. Consider relocating this trimmed file to `src/risk-engine/normalize.ts` (or similar) since "engine" no longer applies, then update its two importers (`src/reports/service.ts`, and wherever `SUPPORTED_WORKFLOWS` moves to).
- **`SUPPORTED_WORKFLOWS`**: move this constant (currently in `src/risk-engine/workflows/index.ts`) to a small standalone module (e.g. `src/workflows/constants.ts`) so `src/reports/service.ts`, `src/thresholds` (being deleted), and `src/workflow-config` (being deleted) don't need it — only `reports/service.ts` and `workflows/routes.ts` will still import it.
- **[src/workflows/routes.ts](src/workflows/routes.ts)**: remove the `PATCH .../checkpoints/:checkpoint` route and the `enabled` field from `CheckpointItem`/`WorkflowItem` responses (once `Checkpoint.enabled` is dropped from the schema, see §3.3). Keep the `GET /` and `GET /:workflow` catalog-listing endpoints — they still serve as the workflow/checkpoint reference list.
- **[src/workflow-executions/](src/workflow-executions/)** (`types.ts`, `routes.ts`, `service.ts`): remove the `mode`/`WorkflowMode` field and the `mode` query filter, since every execution will always be `AGENT_SKILL`. *(This is optional — see §6, Decision 2.)*
- **[src/routes/index.ts](src/routes/index.ts)**: remove the `thresholdRoutes` and `workflowConfigRoutes` registrations.
- **`prisma/seed.ts`**: no structural change needed (it never touched `OrgWorkflowConfig`/overrides), but re-verify after the schema migration that `checkpoints.upsert` still matches the trimmed `Checkpoint` model shape.

### 3.3 Prisma schema changes ([prisma/schema.prisma](prisma/schema.prisma))

- Drop models: `OrgCheckpointOverride`, `OrgThresholdConfig`, `OrgWorkflowConfig`
- Drop enum: `WorkflowMode` (if Decision 2 in §6 goes with full removal) — otherwise keep it but stop ever writing `CHECKPOINTS`
- `Checkpoint` model: drop the `enabled` field (and its now-empty relations to the two dropped override models)
- `Workflow` model: drop the `orgConfigs OrgWorkflowConfig[]` relation field
- `WorkflowExecution` model: drop the `mode WorkflowMode` field (if Decision 2 goes with full removal)
- Run `npm run db:generate` after editing the schema, and create a real migration with `npm run db:migrate` (dev) — **do not hand-edit the generated SQL**.

### 3.4 Documentation

- `CLAUDE.md`: rewrite the "Agent-Skill Workflow Mode" and "Reports Module" sections to remove references to `CHECKPOINTS`/mode resolution/thresholds/checkpoint overrides; update the `Adding a New Feature Module` and Database Schema table (drop the removed models' rows).
- `ARCHITECTURE.md` (currently untracked, `git status` shows `?? ARCHITECTURE.md`): update the several sections that describe the dual-mode design, the `src/risk-engine/`, `src/thresholds/`, `src/workflow-config/` entries, and the "Pluggable checkpoint/workflow engine" principle.

## 4. Data migration concerns (must happen BEFORE the schema migration)

1. **Query production for live usage** before dropping anything:
   ```sql
   SELECT organization_id, workflow_id FROM org_workflow_configs WHERE mode = 'CHECKPOINTS';
   SELECT COUNT(*) FROM org_checkpoint_overrides;
   SELECT COUNT(*) FROM org_threshold_configs;
   ```
   If any organization is actively pinned to `CHECKPOINTS`, their next report-generate call after deploy will silently switch to `AGENT_SKILL` — confirm this is acceptable (likely is, since it's already the platform default for everyone else) and consider a heads-up to that org if this is a paid/contractual feature difference.
2. **`WorkflowExecution.mode`**: confirm via `SELECT DISTINCT mode FROM workflow_executions;` — based on code inspection, `WorkflowExecution` rows are only ever created inside `runAgentSkillWorkflow()` (always `mode: 'AGENT_SKILL'`); the `CHECKPOINTS` branch in `reports/service.ts` never wrote an audit-trail row. So this table should have zero `CHECKPOINTS` rows, but verify before relying on it — a Postgres enum value can't be dropped while rows still reference it.
3. Once confirmed clean, the schema migration in §3.3 can proceed without a manual data-fixup migration.

## 5. Execution order (each phase independently deployable/testable)

1. ✅ **Audit** — ran the queries in §4 against the dev DB; confirmed clean (see Status above).
2. ✅ **Decouple report generation** — `reports/service.ts` always runs `AGENT_SKILL`; `resolveWorkflowModes()`/`resolveEnabledCheckpoints()` and the mode branch are gone.
3. ✅ **Remove config surface** — `src/thresholds/`, `src/workflow-config/`, and the `PATCH .../checkpoints/:checkpoint` route are deleted, along with their registrations in `src/routes/index.ts`.
4. ✅ **Delete risk-engine execution code** — `checkpoints/`, `workflows/`, and `data/` are gone; `src/risk-engine/` is now just `index.ts` (normalize + `SUPPORTED_WORKFLOWS`), `scoring.ts`, `types.ts`.
5. ✅ **Schema migration** — `OrgWorkflowConfig`/`OrgCheckpointOverride`/`OrgThresholdConfig`/`WorkflowMode` dropped, `Checkpoint.enabled`/`WorkflowExecution.mode` dropped; migration `20260913023305_remove_checkpoint_mode` applied and confirmed against the live dev DB.
6. ✅ **Clean up workflow-executions** — Decision 2 went with full removal; `mode` is gone from `src/workflow-executions/{types,service,routes}.ts`.
7. ⚠️ **Update docs** — `ARCHITECTURE.md` done and on disk. `CLAUDE.md` rewrite exists only in a git stash, not landed on `main` — see Status above.
8. ✅ **Regression pass** — full end-to-end verification completed 2026-09-17 against the live dev server; see §7 for the detailed results of each check.

## 6. Decisions needed before starting

1. **Any org still on `CHECKPOINTS`?** If §4's audit finds any, decide whether to notify them or just let them silently move to `AGENT_SKILL` (the platform-wide default already).
2. **`WorkflowExecution.mode` / workflow-executions `mode` filter — drop or keep?**
   - *Keep (lower risk)*: leave the column and `CHECKPOINTS` enum value in place, just guarantee the app never writes it again. Zero changes to `workflow-executions/`. Slightly odd to have a dead enum value forever.
   - *Drop (fully clean)*: remove the field/enum and update `workflow-executions/types.ts`, `routes.ts`, `service.ts`. Matches "remove all code related to checkpoint mode" literally, but touches an audit-trail table and its API contract (`mode` disappears from `GET /api/v1/workflow-executions*` responses) — confirm no dashboard/frontend depends on that field.
   - **Recommendation**: drop it, since no row will ever populate it with anything but `AGENT_SKILL` after step 2, making the field pure dead weight.
3. **`Checkpoint.enabled` and the catalog GET endpoints** — confirm nothing (dashboard, other services) reads `enabled` from `GET /api/v1/workflows` expecting to toggle checkpoints; if something does, that UI needs updating in the same release.

## 7. Regression / verification checklist

No test runner is configured in this repo, so verification is manual. Status of each item as of 2026-09-17 — **all items now verified, checklist fully closed out**:

- [x] `npm run build` passes with zero TypeScript errors — reconfirmed after every phase during implementation.
- [x] Migration applied cleanly — confirmed directly against the dev DB's `_prisma_migrations` table and live schema (see Status above), rather than just a fresh `db:reset`.
- [x] Search the repo for stray references — `grep -rn "CHECKPOINTS\|runRiskEngine\|OrgWorkflowConfig\|OrgCheckpointOverride\|OrgThresholdConfig"` comes back empty outside of this plan document's own historical text.
- [x] Uploaded a CSV statement and ran `POST /api/v1/reports/generate` for all four workflows (`kyc`, `sg`, `traml`, `document-integrity`) against the running `main` dev server (`npm run dev`, port 3001), using a synthetic statement designed to trip gambling, loan-stacking, and layering-style patterns. All four reports reached `Report.status = COMPLETED` (none `FAILED`), each with `ComplianceCheck` rows persisted and a rendered narrative (`executiveSummary`/`reviewerNotes`) — e.g. the `kyc` report produced 7 `ComplianceCheck` rows including three model-introduced `ai-`-prefixed findings (`ai-gambling-risk`, `ai-circular-transfer-pattern`, `ai-repetitive-beneficiary-transfers`), confirming the agent-skill pipeline is genuinely doing the analysis, not returning stub data. (PDF/image were not separately exercised in this pass — that path is unchanged by the checkpoint-mode removal itself and is a LlamaParse-specific concern, not a checkpoint-mode regression risk.)
- [x] `GET /api/v1/reports/:id/workflow-executions` and `GET /api/v1/workflow-executions/:id/conversation` — verified against the freshly-generated `kyc` report: one `COMPLETED` `WorkflowExecution` (no `mode` field, as expected post-removal), with a full conversation trail (3 messages, real `promptTokens`/`completionTokens`, `model: claude-haiku-4-5-20251001`).
- [x] `POST /api/v1/reports/:id/conversations` + `.../messages` — started a conversation on the fresh `kyc` report and asked "What is the single highest-risk finding in this report and why?"; got back a grounded, accurate answer citing the actual `loan-stacking` finding and its evidence (two same-day loan disbursements totaling 55,000) — chat is unaffected by the removal.
- [x] `GET /api/v1/workflows` — catalog lists all 4 workflows with their correct checkpoint slugs (`kyc`: 4, `sg`: 4, `traml`: 7, `document-integrity`: 4), confirming the `Workflow`/`Checkpoint` tables still serve correctly as the agent-skill prompt catalog post-migration.
- [x] Confirm `PUT /api/v1/workflow-config/:workflow`, `PUT/DELETE /api/v1/thresholds/...`, and `PATCH .../checkpoints/:checkpoint` now 404 — the route files/registrations no longer exist, so these paths are unreachable by construction.

## 8. Rollback strategy

- Phases 2–4 (code-only) are revertible by reverting the commit(s) — no data loss.
- Phase 5 (schema migration) is the only hard-to-reverse step: before running `db:migrate:deploy` in production, take a database snapshot/backup. If rollback is needed post-deploy, restoring the dropped tables requires either the backup or re-running the older migration files — Prisma down-migrations are not automatic, so treat this as a point of no return and get explicit sign-off before deploying it to production.
- Recommended: deploy phases 2–4 first and let them bake (confirms `AGENT_SKILL`-only behavior is stable in production) before committing to the irreversible schema migration in phase 5.
