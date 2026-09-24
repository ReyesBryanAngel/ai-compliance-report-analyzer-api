# ai-compliance-report-analyzer-api

Backend API for **pds Tech** ([pds-tech.ai](https://pds-tech.ai/)), which screens iGaming players' financial documents (bank statements, payslips) against compliance risk indicators.

Clients upload CSV, PDF or image statements. Each file is parsed into normalized transactions, and each one can then be run through one or more compliance workflows (`kyc`, `sg`, `traml`, `document-integrity`). An LLM carries out the analysis, guided by versioned instructions written by subject-matter experts. The result is a scored report with a full audit trail of every model call, and users can then chat with an LLM about a finished report.

**Stack:** Node.js, TypeScript, Fastify 5, Prisma 7 on PostgreSQL, AWS S3, LlamaParse (PDF/image parsing), Anthropic Claude (analysis and chat). Background jobs run on Postgres-backed queues, so there's no Redis.

## Getting started

You need Node.js 20.6 or later (the dev scripts use `--env-file`), a PostgreSQL database, an S3 bucket, and API keys for LlamaParse and Anthropic.

```bash
npm install
cp .env.example .env      # then fill in the values
npm run db:migrate        # create the schema
npm run db:seed           # workflows, default SME instructions, a default org and admin user
npm run dev               # http://localhost:3000
```

Check it's running with `GET /api/v1/health`.

`npm run db:seed` creates a local admin login, `admin@example.com` / `Admin1234!`. Change or remove it before seeding any shared environment.

Every environment variable is described under "Environment Variables" in [CLAUDE.md](CLAUDE.md). All routes are under `/api/v1/`, and [postman_collection.json](postman_collection.json) has example requests.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` | Generate the Prisma client and compile TypeScript to `dist/` |
| `npm run start` | Run the compiled build |
| `npm run db:migrate` | Create and apply migrations in development |
| `npm run db:migrate:deploy` | Apply migrations in production |
| `npm run db:generate` | Regenerate the Prisma client after editing `prisma/schema.prisma` |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Drop the database and re-apply all migrations |
| `npm run db:seed` | Seed the database |

There is no test suite yet.

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, modules, request and data flow, design decisions |
| [CLAUDE.md](CLAUDE.md) | Detailed working guide: env vars, module internals, database models. Also read by Claude Code |
| [docs/PDS_TECH.md](docs/PDS_TECH.md) | Product promises, risk indicator coverage, pricing plans |
| [docs/MULTI_TENANT_GAPS.md](docs/MULTI_TENANT_GAPS.md) | Known tenancy, billing and queue gaps, as a checklist |
| [docs/COGNITO_PLAN.md](docs/COGNITO_PLAN.md) | Plan for moving auth to Amazon Cognito |
| [docs/LLAMAPARSE.md](docs/LLAMAPARSE.md) | LlamaParse limits, data residency, cost estimates |
| [docs/SECURITY.md](docs/SECURITY.md) | Security practices |
| [docs/SECURITY_GAPS.md](docs/SECURITY_GAPS.md) | Security work still needed before real player data, as a checklist |
| [docs/diagrams/](docs/diagrams/) | Database schema and user flow (draw.io) |
| [docs/archive/](docs/archive/) | Completed plans, kept for history |

## Deployment

[render.yaml](render.yaml) deploys to Render.com: it builds with `npm install && npm run build`, then runs `prisma migrate deploy` and `node dist/server.js`. There is no CI pipeline yet.
