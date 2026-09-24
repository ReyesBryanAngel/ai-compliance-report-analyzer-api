# pds Tech: Product Context

This API is the backend for **pds Tech**, a player document screening product for iGaming operators. These notes summarize what [pds-tech.ai](https://pds-tech.ai/) promises customers, captured on 2026-09-24, so engineering decisions can be checked against it.

## What the product is

pds Tech is a self-serve, API-first service that screens players' financial documents for iGaming operators. It is also designed as a tool that operators' AI agents can call. It reads bank statements, payslips and other supporting evidence. It checks each document for fraud and tampering, screens it against more than 60 risk indicators, and returns a risk score or RAG (red/amber/green) marker with a full audit trail.

The company describes it this way: "pds Tech is an API-first application and AI-agent tool that automates customer financial document screening for global iGaming operators. It instantly parses messy, complex bank statements against multiple compliance risk indicators to accelerate high-value onboarding and protect Net Gaming Revenue through the review process."

It also states its scope: "We do bank statement and document screening very well. We don't try to do anything else."

| Item | Detail |
| --- | --- |
| Company | pds Tech (legal name TCAC Tech Holdings Ltd), Maidstone, Kent, UK |
| Customers | iGaming operators, whose compliance teams, player account management systems (PAMs), CRMs and risk platforms call the API |
| Documents | Bank statements, payslips, other supporting financial evidence |
| Integration | API from the operator's PAM, KYC vendor or CRM. There is no separate UI, and results go back into the operator's own systems |
| Main regulation | UK Gambling Commission Social Responsibility Code 3.4.3, "identify" stage of customer interaction |
| Free trial | Up to 10 documents |

## Promises that constrain engineering

The website makes these promises to customers. Changes to parsing, analysis or infrastructure should keep them true.

| Promise on the website | What it means for this codebase |
| --- | --- |
| "Seconds, not minutes, per document" | Keep parsing and analysis latency low. Polling a slow external parser works against this |
| Fraud and tamper checks on every document ("digitally manipulated PDFs, altered text layers and fabricated transactions") | The `document-integrity` workflow and access to the original PDF structure matter. A parser that only returns text may hide tampering signals |
| 60+ risk indicators | Delivered through SME instructions per workflow (`src/sme-instructions/`), not hardcoded rules |
| "Immutable & exportable" audit trail for every decision | `WorkflowExecution` → `AgentConversation` → `AgentExecution` → `AgentMessage` must record every run |
| Compliance teams change thresholds and scoring rules without an engineering release | Thresholds belong in versioned `AgentSkillInstruction` text, not in code |
| Usage measured and billed inside the platform | Billing is per page, so page counts need to be tracked accurately |
| Tenancy isolation (dedicated VPC for Major Player) | Keep data scoped by `organizationId`. Enterprise may require documents to never leave the tenant's environment, which affects the choice of third-party parser. LlamaParse offers single-tenant SaaS, BYOC and self-hosted options for this, and an EU region for the other tiers (see "Data Handling & Deployment" in [LLAMAPARSE.md](LLAMAPARSE.md)) |
| Cloud-agnostic, runs 24/7 | Avoid depending on a single vendor where possible, and plan for a third-party service being down |

## Risk indicator coverage

The website lists these indicator groups. The workflow column shows the closest match among our `SUPPORTED_WORKFLOWS`. This mapping is an inference from the names and has not been confirmed.

| Indicator group | What the website says it detects | Closest workflow |
| --- | --- | --- |
| Document fraud | Digitally manipulated PDFs, altered text layers, fabricated transactions | `document-integrity` |
| Source of Funds (SoF) | Where a player's deposited funds come from | `kyc` |
| Source of Wealth (SoW) | The wealth behind larger or higher-risk players | `kyc` |
| Income & affordability | Payslip assessment and recurring income analysis | `kyc` / `sg` |
| Anti-Financial Crime (AFC) | Cash deposit patterns, secrecy jurisdictions, layering signals | `traml` |
| Anti-Money Laundering (AML) | Transaction patterns that AML frameworks require catching | `traml` |
| Vulnerability / Safer Gambling | Gambling exposure, overdrafts, behavioural signals | `sg` |
| Debt recovery | Debt collection activity, missed bills, court activity, without relying on static lists | `sg` |

## Pricing plans

Plans are priced by pages per month, and actual prices are confidential ("contact us for a quote"). Every plan includes a full audit trail and API access. Rates are being updated for 2026/27.

| Plan | Tenancy | Pages per month | Pages per year | Extras | Saving claimed |
| --- | --- | --- | --- | --- | --- |
| Startup | Multi-tenant | 500 | 6,000 | — | 24% |
| Challenger | Multi-tenant | 2,500 | 30,000 | — | 49% |
| Tier 2 Scaler | Multi-tenant | 10,000 | 120,000 | Priority support & SLA | 58% |
| Major Player | Single-tenant, enterprise | 50,000 | 600,000 | Dedicated VPC & tenancy isolation | 61% |

The "Saving claimed" column is what the website says each plan saves customers compared with manual review. It is not a discount from a third party. The Security section of the website says "Tiers 1–3 run multi-account, single-tenant", while the pricing table calls those tiers multi-tenant. Confirm which is correct before designing tenancy features.

For what parsing costs at these volumes, see [LLAMAPARSE.md](LLAMAPARSE.md).

## Security claims

- **Tenant separation:** Enterprise customers get a fully isolated single-tenant environment.
- **Full auditability:** Every decision creates an immutable, exportable audit trail tied to the player account.
- **Controlled access:** Role-based access and secure handling of sensitive documents throughout the pipeline.
- **Regulatory alignment:** Supports the "identify" stage of UKGC SR Code 3.4.3.

## Source

- [pds-tech.ai](https://pds-tech.ai/), homepage and FAQ, retrieved 2026-09-24
