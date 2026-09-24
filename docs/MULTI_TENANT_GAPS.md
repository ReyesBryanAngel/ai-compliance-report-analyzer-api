# Multi-Tenant Gaps

This is a list of cases the codebase doesn't handle yet when several users from different organizations upload many documents and generate many reports under the pricing plans in [PDS_TECH.md](PDS_TECH.md). It was written on 2026-09-24 from a review of the code at commit `a4d90c2`.

Each item has a checkbox. When an item is fixed, tick it and add a short note with the PR or commit. Line references were correct when this was written, so check them against the current code.

**Suggested order:** section 1 first, because those are live data leaks between organizations. Then items 17 and 21, which cause duplicate work and wrong results once more than one server runs. Then items 7–9, without which the per-page plans can't be sold or enforced. Section 8 (separate API and worker containers) can start any time, but run more than one worker replica only after items 17 and 18 are fixed.

**Auth:** items 2, 5, 6 and 34 are being addressed by moving to Amazon Cognito. Items 1, 3 and 4 are fixed first, since Cognito doesn't fix them. See [COGNITO_PLAN.md](COGNITO_PLAN.md).

## 1. Data leaking between organizations

- [ ] **1. A user with no organization can see every organization's data.** The org filter is written as `orgId ? { organizationId: orgId } : {}` throughout. A user whose JWT has an empty `organizationId` gets no filter at all, so they can read every org's documents, reports, audit trails and chats. Affected files:
  - `/documents/list`, `/documents/:id` and `/documents/:id/file` in [src/documents/routes.ts](../src/documents/routes.ts)
  - `listReports` and `getReport` in [src/reports/service.ts](../src/reports/service.ts)
  - [src/workflow-executions/service.ts](../src/workflow-executions/service.ts)
  - [src/report-conversations/service.ts](../src/report-conversations/service.ts)

  Either require every user to belong to an organization, or scope org-less users to their own `userId`.
- [ ] **2. Anyone can join any organization.** `POST /auth/register` accepts any existing `organizationId` with no invite or approval ([src/auth/service.ts](../src/auth/service.ts)). `GET /organizations` lists every org's ID to any logged-in user ([src/organizations/routes.ts](../src/organizations/routes.ts)), so an outsider can register into another operator's org. This needs an invite flow, and the org listing should return only the caller's own org.
- [ ] **3. Some document endpoints never check the organization.** All of these are in [src/documents/routes.ts](../src/documents/routes.ts):
  - `POST /documents/:id/parse` doesn't check the org, so any user can re-parse another org's document, overwrite its `parsedData`, and spend parsing credits.
  - `GET /documents/:id/parse-status` doesn't check the org.
  - `GET /documents/queue/status` returns counts for all tenants combined.
  - `queuePosition` counts other tenants' queued jobs, which reveals how busy they are.
- [ ] **4. Batches don't belong to an organization.** `DocumentBatch` has no `organizationId` in [prisma/schema.prisma](../prisma/schema.prisma). Batches are scoped only indirectly, through the documents in them.
- [ ] **5. The organization is baked into a token that lasts 365 days.** `JwtPayload.organizationId` is fixed when the token is issued, and access tokens last 365 days ([src/plugins/auth.ts](../src/plugins/auth.ts)). If a user is removed or moves to another org, their token keeps the old access for a year, and there's no way to revoke an access token. Use short-lived access tokens, which the rotating refresh tokens already support, or look up the user's org on each request.
- [ ] **6. There are no roles.** The site promises "role-based access", but any member of an org can create, activate or delete SME instructions, which changes scoring for the whole org. Separate roles are needed at least for admin, SME or compliance, and read-only or API users.

## 2. Plans, quotas and billing

- [ ] **7. Plans aren't stored anywhere.** `Organization` has no plan, monthly page allowance, billing period or trial flag, so nothing separates Startup (500 pages/month), Challenger (2,500), Tier 2 Scaler (10,000) and Major Player (50,000).
- [ ] **8. Pages aren't counted.** Billing is per page, but `Document` has no `pageCount`. Nothing records pages used per org per billing period, and LlamaParse's page and credit usage isn't captured.
- [ ] **9. Nothing enforces the limits.** An org can go past its monthly page allowance, and the free trial (up to 10 documents) isn't enforced. Checks are needed at upload, at re-parse and at report generation.
- [ ] **10. There is no usage endpoint.** The site says usage is "measured and billed inside the platform", but an org has no way to see what it has used.
- [ ] **11. Re-parses and duplicate uploads have no billing rule.** It's undecided whether re-parsing the same file counts again. There's no content hash on `Document`, so the same statement uploaded twice is parsed and billed twice.

## 3. Fairness and plan priority in the queues

- [ ] **12. The parse queue is first-come, first-served.** It orders jobs by `queuedAt` only ([src/documents/parse-queue.ts](../src/documents/parse-queue.ts)), so one org uploading 500 PDFs blocks every other org's parsing. The report queue already rotates between tenants ([src/reports/report-queue.ts](../src/reports/report-queue.ts)); the parse queue doesn't.
- [ ] **13. Plans don't affect priority.** Tier 2 Scaler promises "priority support & SLA", but neither queue has priority or per-plan weighting.
- [ ] **14. There are no per-org concurrency caps.** Even with rotation, one tenant can take every claimed slot when the queue is otherwise quiet.
- [ ] **15. One slow job holds up its whole batch.** Both workers wait for the entire batch (`Promise.allSettled`) before claiming more work. One 60-second LlamaParse poll or slow LLM call leaves the other slots idle, which works against the "seconds, not minutes" promise. Each finished job should free its slot straight away.
- [ ] **16. Requests aren't rate-limited.** There's no `@fastify/rate-limit` or similar, so one client can flood `/upload`, `/upload-url`, `/reports/generate` or the report chat.

## 4. Running more than one server

- [ ] **17. Restarting one server can make two servers run the same job.** On startup, each worker resets every `PROCESSING` job to `QUEUED` (`start()` in both queue files), including jobs another live server is working on. The job then runs twice, costing double LLM and parse calls and possibly writing results twice.
- [ ] **18. Jobs can get stuck for good.** If a server dies and doesn't restart, its `PROCESSING` jobs stay stuck, because there's no heartbeat or lease timeout to put them back in the queue. A heartbeat or lease with a timeout would fix this and also replace the reset on startup from item 17.
- [ ] **19. The LlamaParse limit only applies per server.** `Semaphore(20)` in [src/parser/llama-parse.ts](../src/parser/llama-parse.ts) lives in each process, so N servers make up to 20×N calls at once and break LlamaParse's rate limit. The limit has to be shared across servers.
- [ ] **20. Nothing limits Anthropic calls across tenants.** No global throttle or per-org budget controls LLM traffic.

## 5. Correctness under many concurrent reports

- [ ] **21. Retries duplicate findings and flip the report status.** `processReport` in [src/reports/service.ts](../src/reports/service.ts) writes `ComplianceCheck` rows one at a time, then generates the narrative. If the narrative fails, the report is set to `FAILED` and the job goes back in the queue. The retry then adds a second set of checks, and clients polling the report see it go from `FAILED` back to `COMPLETED`. Writing the checks and the report update in one transaction would fix this, and so would clearing old checks before a retry. The report should also stay `GENERATING` until the last attempt fails.
- [ ] **22. Reports don't use a snapshot of the parsed data.** The report worker reads `doc.parsedData` when it runs, not when the report was requested. A re-parse in between changes the input, or sets it to null or `FAILED`. The worker doesn't check for null, so it crashes.
- [ ] **23. The same report can be generated twice.** `/reports/generate` has no idempotency key, so a client that retries creates duplicate reports and duplicate LLM spend.
- [ ] **24. Parsing is marked failed on the first error.** `parseDocument` sets `Document.status = FAILED` on the first failed attempt even though the parse job will retry. Clients see `FAILED` and may give up.
- [ ] **25. One report per document can't cover one player.** Each report covers a single (document, workflow) pair. A player who uploads three months of statements plus a payslip gets separate reports, not one assessment across all their documents.

## 6. Uploads

- [ ] **26. Pre-signed uploads skip the 10 MB limit.** The pre-signed PUT URL in `createUploadUrl` ([src/documents/service.ts](../src/documents/service.ts)) doesn't restrict size or content type, and `confirmUpload` doesn't check either afterwards. The 10 MB multipart limit in `app.ts` applies only to the direct upload path.
- [ ] **27. Unconfirmed uploads leave orphans.** If a client calls `upload-url` and never confirms, a `Document` stays in `PROCESSING` with size 0 and no file in S3. Nothing cleans these up.
- [ ] **28. Batch naming breaks on the direct upload path.** On `POST /documents/upload`, the batch is created only if `batch_name` arrives before the file parts, and batches have no owner (see item 4).

## 7. Audit, retention and integration

- [ ] **29. Audit records aren't tied to a player or an operator.** `Document` has no `playerId` or `externalReference`, but the site promises an audit trail "tied to the player account".
- [ ] **30. The audit trail can't be exported and isn't protected from deletion.** There's no export endpoint. Deleting a report cascades and removes its `WorkflowExecution` rows and messages, so the trail is neither "immutable" nor "exportable".
- [ ] **31. There's no deletion or retention policy.** Documents can't be deleted, there's no GDPR erasure, and there's no per-org retention period for S3 objects or `parsedData`.
- [ ] **32. Files from different orgs sit together in S3.** S3 keys use one shared `S3_KEY_PREFIX`, not a prefix per organization, and there's no per-tenant encryption key (SSE-KMS). Major Player's "dedicated VPC & tenancy isolation" needs this.
- [ ] **33. Every tenant uses one hardcoded LlamaParse region.** `BASE_URL` is always the US endpoint. There's no per-tenant setting for the EU region or a single-tenant deployment (see [LLAMAPARSE.md](LLAMAPARSE.md)).
- [ ] **34. Operators have to poll and log in as a person.** There are no webhooks or callbacks when parsing or a report finishes, and no API keys, so PAM, CRM and KYC systems have to authenticate with a person's email and password.
- [ ] **35. List endpoints aren't paginated.** `/documents/list` creates a pre-signed download link for every document on each call, and `/reports` parses every report's `content` JSON. At Major Player volume (50,000 pages a month) both become very slow. `Document` and `Report` also have no indexes on `organizationId` or `status`.

## 8. Separating the API and the workers

DevOps has asked for separate API and worker containers. This is still worth doing after every item above is fixed, because it solves a different problem. The items above are about correctness: who can see what, who goes first, and not running a job twice. The split is about how each part scales, deploys and fails:

- **Different scaling signals.** The API should scale on requests. Workers should scale on queue depth and on the LlamaParse and Anthropic rate limits. Today every API replica also runs both workers, so adding API capacity also raises external call concurrency (see item 19).
- **Deploys.** Report jobs take 30–60 seconds or more. A rolling API deploy kills them mid-run, and even with item 18 fixed, the tokens and parse credits already spent are lost. A separate worker service can have a longer shutdown window and finish its jobs.
- **Failure isolation.** Workers hold large `parsedData` JSON and build large prompts. A worker that runs out of memory should restart the worker, not drop API requests.
- **Fewer permissions for the API.** Separate ECS task roles let the API go without LlamaParse keys and without write access to the client-data bucket.

The split won't make reports faster. Both workloads mostly wait on network calls, not CPU, so latency depends on items 15 and 20, not on where the workers run.

Fix items 17 and 18 before running more than one worker replica.

- [ ] **36. The workers run inside the API process.** `parseQueuePlugin` and `reportQueuePlugin` are registered in [src/app.ts](../src/app.ts), so every API replica also runs both workers. Add a worker-only entry point (for example `src/worker.ts`) that sets up Prisma and both queues without an HTTP server, plus a flag such as `RUN_WORKERS=false` so the API stops registering the queue plugins. Move both queues to the worker, not just reports: the parse queue has the same workload shape and the tighter external limit. Report chat stays in the API, since it's a synchronous request.
- [ ] **37. Build one image with two start commands, not two Dockerfiles.** Two Dockerfiles mean two builds that can drift apart in dependencies, the generated Prisma client, or code version. Build one image and set the command in each ECS task definition, for example `node dist/server.js` for the API and `node dist/worker.js` for the worker.
- [ ] **38. Run migrations as a separate one-off task.** Neither the API nor the worker container should run `db:migrate:deploy` on startup, or several replicas starting at once will race to migrate.
- [ ] **39. A separate worker only notices new jobs when it next checks the queue.** `enqueue()` wakes the worker immediately only when both run in the same process. Once split, new jobs wait up to 5 seconds (`POLL_INTERVAL_MS`) to be picked up. That delay may be acceptable; if not, use Postgres `LISTEN/NOTIFY` to wake the worker.
- [ ] **40. Nothing handles shutdown, so jobs in progress are killed.** Both queues' `stop()` already stops claiming new jobs and waits for the current batch, but it only runs from Fastify's `onClose` hook, and nothing in `src/` listens for `SIGTERM` or calls `server.close()`. When ECS stops a task, the process dies mid-job. Add a `SIGTERM` handler to both entry points that calls `close()`, and set the worker's ECS `stopTimeout` longer than the slowest expected job, including LlamaParse's roughly 60-second poll and the LLM retries.
