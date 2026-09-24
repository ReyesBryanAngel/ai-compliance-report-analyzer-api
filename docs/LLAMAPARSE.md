# LlamaParse: Limitations, Rate Limits, Supported Documents & Pricing

Reference notes on LlamaParse, the only PDF/image parser used by this API. Figures are taken from the LlamaIndex docs as of 2026-09-23. Check the [sources](#sources) before relying on them for billing or capacity decisions.

## Overview

LlamaParse is a document parsing service from LlamaIndex. It turns more than 130 file formats into structured text or markdown, including PDFs, images, office documents, spreadsheets and audio. It is billed in credits at $1.25 per 1,000 credits, and each page costs 1 to 45 credits depending on the parse mode. At 500 to 50,000 pages per month, parsing costs $0.63 to $2,812.50 per month, before subscription fees.

| Item | Value |
| --- | --- |
| Provider | LlamaIndex (LlamaCloud) |
| Supported formats | 130+ (documents, images, spreadsheets, audio) |
| Maximum file size | 512 MB |
| Parse upload rate limit | 50 requests per second per organization (Free tier: 20 requests per minute) |
| Parse modes | Fast (1 credit/page), Cost-effective (3), Agentic (10), Agentic Plus (45) |
| Credit price | $1.25 per 1,000 credits |
| Subscription plans | Free ($0), Starter ($50/mo), Pro ($500/mo), Enterprise (custom) |

## How this codebase uses LlamaParse

The client is [src/parser/llama-parse.ts](../src/parser/llama-parse.ts), a hand-written `fetch()` client that does not use the SDK.

| Area | Current setting | Relevant LlamaParse limit |
| --- | --- | --- |
| Formats sent to LlamaParse | PDF, JPEG, PNG, WebP (`PdfParser`, `ImageParser`) | 130+ supported |
| Formats parsed locally | CSV (`CsvParser`); costs no credits | — |
| Accepted but unparsed | XLS, XLSX, DOCX (in `ALLOWED_MIME_TYPES`, not in `PARSEABLE_MIME_TYPES`) | All three are supported by LlamaParse |
| Concurrent LlamaParse calls | 20 (`Semaphore`) | — |
| Parse queue throughput | Batches of 20 jobs every 5 s (about 240 uploads/min at most) | 50 QPS on paid plans; 20 requests/min on Free |
| Result polling | Every 3 s, gives up after about 60 s | Job timeout of up to 2 h plus 5 min per page |
| Upload size (our API) | 10 MB per file, 10 files per request | 512 MB |
| Parse mode | Not set in the upload form, so LlamaParse's default mode is used. Only `file` and `parsing_instruction` are sent | See [Pricing](#pricing) |
| Failure handling | No local fallback. A missing key, failed job or network error makes the parse throw, and the job retries up to `maxAttempts` (3) | — |

What these settings mean:

- **The Free tier is too slow for production.** A single queue burst can exceed its 20 requests per minute and return `429` errors.
- **Our timeout is much shorter than LlamaParse's.** We stop polling after about 60 s, so long multi-page statements can fail on our side while LlamaParse is still working.
- **Retries and re-parses cost credits.** A failed job can retry up to 3 times, and `POST /api/v1/documents/:id/parse` re-parses on request. Either one can consume extra credits.
- **The parse mode sets the cost.** If you set a parse mode in the upload form, the cost per page changes (see [Pricing](#pricing)). Update this doc when you do.

## Supported Document Types

LlamaParse supports more than 130 file formats in four categories: documents, images, spreadsheets and audio ([source](https://developers.llamaindex.ai/llamaparse/general/supported_document_types/)). Spreadsheets are billed at 1 credit per sheet and audio at 3 credits per minute. All other formats are billed per page.

| Category | Common formats | Also supported |
| --- | --- | --- |
| Documents | pdf, docx, doc, pptx, ppt, rtf, txt, epub | 602, abw, cgm, cwk, docm, dot, dotm, hwp, key, lwp, mw, mcw, pages, pbd, pptm, pot, potm, potx, sda, sdd, sdp, sdw, sgl, sti, sxi, sxw, stw, sxg, uof, uop, uot, vdx, vsd, vsdm, vsdx, vor, wpd, wps, xml, yxmd, zabw |
| Images | jpg, jpeg, png, gif, bmp, tiff, webp, heic, heif | svg, htm, html |
| Spreadsheets | xlsx, xls, csv, tsv, numbers, ods | xlsm, xlsb, xlw, dif, sylk, slk, prn, et, fods, uos1, uos2, dbf, wk1–wk4, wks, 123, wq1, wq2, wb1–wb3, qpw, xlr, eth |
| Audio | mp3, mp4, wav, m4a, webm | mpeg, mpga |

## Rate Limits

The parse upload endpoint allows 50 requests per second per organization. Free-tier organizations are limited to 20 requests per minute ([source](https://developers.llamaindex.ai/llamaparse/general/rate_limits/)).

| Endpoint | Route | Limit | Window | Applies per |
| --- | --- | --- | --- | --- |
| Parse upload | `POST /api/v1/parsing/upload` | 50 QPS | 10 seconds | Organization |
| File upload | `POST /api/v1/beta/files` | 50 QPS | 5 seconds | Project |
| Classify | `POST /api/v2/classify` | 40 QPS | 1 second | Not stated |
| Any endpoint (Free tier) | All | 20 requests/min | 1 minute | Organization |
| Endpoints not listed | Various | Default limits, which may change | Not stated | Not stated |

- A request over the limit returns `429 Too Many Requests`. LlamaIndex suggests batching requests or contacting support if this happens often.
- The Enterprise plan advertises 5x higher rate limits ([source](https://www.llamaindex.ai/pricing)).
- Job status and result polling are not listed endpoints, so the default limits apply to them.

## Limitations

LlamaParse accepts files up to 512 MB. Parsing reads up to 64 KB of text and 35 images per page ([source](https://developers.llamaindex.ai/llamaparse/general/limitations/)).

| Service | Limit | Value |
| --- | --- | --- |
| General | Maximum file size | 512 MB |
| General | Stored files per project | Free: 10,000 files / 10 GB; Starter: 50,000 / 50 GB; Pro: 100,000 / 100 GB; Enterprise: unlimited |
| Parse | Supported formats | 130+ |
| Parse | Images per page | 35 (only the largest are extracted) |
| Parse | Text per page | 64 KB (anything beyond is ignored) |
| Parse | Job timeout | Base of up to 2 hours, plus up to 5 minutes per page |
| Extract | Maximum file size | 100 MB |
| Extract | Maximum pages | 500 for files larger than 5 MB |
| Extract | Schema limits | 5,000 properties, 7 levels deep, 120,000 characters of strings, 150,000 characters raw JSON |
| Classify | Rules | At least 1, all unique; type 1–50 characters; description 10–2,000 characters |
| Split | File size and formats | 512 MB; PDF, DOC, DOCX, PPT, PPTX; 1–50 categories per job |
| Index | Concurrent parse jobs | 30 per project |

## Data Handling & Deployment

LlamaParse runs in a North America region and an EU region, and there is no UK region. It offers a DPA, holds a SOC 2 Type II report, and can be deployed as single-tenant, in your own cloud (BYOC), or on-premises.

| Topic | What LlamaIndex publishes |
| --- | --- |
| Regions | North America (`api.cloud.llamaindex.ai`, AWS `us-east-1`) and EU (`api.cloud.eu.llamaindex.ai`, AWS `eu-central-1`, Frankfurt). No UK region ([source](https://developers.llamaindex.ai/llamaparse/general/regions/)) |
| Data residency | "Data will be stored within the region it is uploaded to." In the EU region, storage and processing stay in the EU |
| EU region caveats | New features reach North America first. Organizations cannot be migrated between regions |
| Deployment options | Managed SaaS (NA or EU), single-tenant SaaS, BYOC on AWS, Azure or GCP, and self-hosted or on-premises ([source](https://developers.llamaindex.ai/llamaparse/general/enterprise-readiness/deployment/)) |
| Data Processing Agreement | Available through enterprise contracting. Covers scope of processing, data subject rights, subprocessor disclosure, breach notification and deletion ([source](https://developers.llamaindex.ai/llamaparse/general/enterprise-readiness/compliance/)) |
| EU transfers | The EU DPA includes Standard Contractual Clauses for EU-to-US transfers, which "can include access by US-based engineering and operational personnel" ([source](https://developers.llamaindex.ai/llamaparse/general/enterprise-readiness/eu-compliance/)) |
| Certifications | SOC 2 Type II, with the report in the [Trust Center](https://security.llamaindex.ai). HIPAA pipeline with a BAA for Enterprise. GDPR Article 27 EU representative appointed |

These are not published, so ask LlamaIndex sales:

- Whether a UK GDPR addendum is available
- The subprocessor list, including which LLM providers process documents and where
- How long uploaded files and parse results are kept
- Whether customer documents are used for model training
- Pricing for single-tenant and BYOC deployments

### What this means for this codebase

- **We currently send documents to North America.** `BASE_URL` in [src/parser/llama-parse.ts](../src/parser/llama-parse.ts) is hardcoded to `https://api.cloud.llamaindex.ai/api/parsing`, so UK players' bank statements are stored and processed in AWS `us-east-1`.
- **Moving to the EU region takes more than a URL change.** You'd change the base URL to `https://api.cloud.eu.llamaindex.ai/api/parsing`, ideally through a configurable env var rather than a hardcoded value. You'd also need an API key from a new EU organization, because organizations can't be migrated between regions.
- **Major Player needs an Enterprise deployment.** pds Tech promises Major Player "dedicated VPC & tenancy isolation" (see [PDS_TECH.md](PDS_TECH.md)). Shared managed SaaS doesn't meet that, so it needs LlamaParse single-tenant SaaS or BYOC inside the customer's VPC. A per-tenant LlamaParse endpoint and API key would then be needed, instead of one global `LLAMA_PARSE_API_KEY`.

## Pricing

LlamaParse bills in credits at $1.25 per 1,000 credits. Each parsed page costs 1 to 45 credits depending on the parse mode ([source](https://developers.llamaindex.ai/llamaparse/general/pricing/)). With the Cost-effective mode, parsing costs $0.00375 per page.

### Credits per page

| Parse mode | Credits per page | Cost per page (USD) |
| --- | --- | --- |
| Fast | 1 | $0.00125 |
| Cost-effective | 3 | $0.00375 |
| Agentic | 10 | $0.0125 |
| Agentic Plus | 45 | $0.05625 |

Add-ons cost extra: layout extraction is +3 credits per page, and enriched forms output (Beta) is +10 credits per page that contains a form. Spreadsheets cost 1 credit per sheet, and audio costs 3 credits per minute. Retained file storage costs 100 credits per GB per day.

### LlamaParse subscription plans

| Plan | Monthly fee | Included credits per month | Pay-as-you-go cap | Notes |
| --- | --- | --- | --- | --- |
| Free | $0 | 10,000 | Up to $500/mo | Rate limit of 20 requests/min |
| Starter | $50 | 40,000 | Up to 400,000 credits | — |
| Pro | $500 | 400,000 | Up to $5,000/mo | One-time bonus of 800,000 credits (limited time) |
| Enterprise | Custom | Volume discount | Custom | 5x rate limits, SSO, deployment options, dedicated account manager |

Source: [LlamaIndex pricing](https://www.llamaindex.ai/pricing). Credits beyond the included amount are billed at $1.25 per 1,000.

### Estimated cost per product plan tier

The estimates below use our product's pricing plans and assume every page is a PDF or image page sent to LlamaParse.

```
Monthly cost (USD) = pages per month × credits per page × 1.25 / 1000
```

Credit usage only (before LlamaParse subscription fees), per month:

| Plan tier | Pages/mo | Fast | Cost-effective | Agentic | Agentic Plus |
| --- | --- | --- | --- | --- | --- |
| Startup (multi-tenant) | 500 | $0.63 | $1.88 | $6.25 | $28.13 |
| Challenger (multi-tenant) | 2,500 | $3.13 | $9.38 | $31.25 | $140.63 |
| Tier 2 Scaler (multi-tenant) | 10,000 | $12.50 | $37.50 | $125.00 | $562.50 |
| Major Player (single-tenant) | 50,000 | $62.50 | $187.50 | $625.00 | $2,812.50 |

Credit usage only, per year (12 months at full capacity):

| Plan tier | Pages/yr | Fast | Cost-effective | Agentic | Agentic Plus |
| --- | --- | --- | --- | --- | --- |
| Startup | 6,000 | $7.50 | $22.50 | $75.00 | $337.50 |
| Challenger | 30,000 | $37.50 | $112.50 | $375.00 | $1,687.50 |
| Tier 2 Scaler | 120,000 | $150.00 | $450.00 | $1,500.00 | $6,750.00 |
| Major Player | 600,000 | $750.00 | $2,250.00 | $7,500.00 | $33,750.00 |

Total monthly cost including the LlamaParse subscription. This assumes Starter as the minimum plan for production, because the Free tier's 20 requests per minute is too low for our queue.

| Plan tier | Credits/mo (Cost-effective) | LlamaParse plan | Total/mo | Credits/mo (Agentic) | LlamaParse plan | Total/mo |
| --- | --- | --- | --- | --- | --- | --- |
| Startup | 1,500 | Starter | $50.00 | 5,000 | Starter | $50.00 |
| Challenger | 7,500 | Starter | $50.00 | 25,000 | Starter | $50.00 |
| Tier 2 Scaler | 30,000 | Starter | $50.00 | 100,000 | Starter + 60,000 overage | $125.00 |
| Major Player | 150,000 | Starter + 110,000 overage | $187.50 | 500,000 | Pro + 100,000 overage | $625.00 |

One LlamaParse subscription covers the whole organization, so if all tiers share one account, their credits add up. At 63,000 pages per month in Cost-effective mode, that is 189,000 credits, or $236.25 per month on Starter.

Caveats:

- **Major Player may need LlamaParse Enterprise.** Dedicated VPC and tenancy isolation may require Enterprise's deployment options, which have custom pricing.
- **The "Saves" percentages are ours.** The percentages in our product's pricing plans are customer discounts, not LlamaParse discounts.

## Sources

- [LlamaParse — Rate Limits](https://developers.llamaindex.ai/llamaparse/general/rate_limits/)
- [LlamaParse — Limitations](https://developers.llamaindex.ai/llamaparse/general/limitations/)
- [LlamaParse — Supported Document Types](https://developers.llamaindex.ai/llamaparse/general/supported_document_types/)
- [LlamaParse — Pricing (credits per page)](https://developers.llamaindex.ai/llamaparse/general/pricing/)
- [LlamaIndex — Subscription plans](https://www.llamaindex.ai/pricing)
- [LlamaParse — Regions](https://developers.llamaindex.ai/llamaparse/general/regions/)
- [LlamaParse — Deployment & Data Residency](https://developers.llamaindex.ai/llamaparse/general/enterprise-readiness/deployment/)
- [LlamaParse — Compliance](https://developers.llamaindex.ai/llamaparse/general/enterprise-readiness/compliance/)
- [LlamaParse — EU Data Protection](https://developers.llamaindex.ai/llamaparse/general/enterprise-readiness/eu-compliance/)
- Internal product pricing plans: Startup, Challenger, Tier 2 Scaler, Major Player
