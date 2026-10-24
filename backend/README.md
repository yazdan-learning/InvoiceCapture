# Expense Management Backend

Express + TypeScript + Prisma/PostgreSQL API. Three modules, enabled per organization
(`Organization.modules`):

- `EXPENSES` — receipts and mileage, routed through a submit → approve/reject workflow.
- `PURCHASE_INVOICES` — supplier invoices captured by the accountant and sent to the
  organization's accounting system through an `AccountingConnector` (no approval step).
- `RAW_MATERIAL_PRICING` — proof of concept: raw materials matched to price-index categories
  by AI, with new prices proposed from the index and the exchange rate and approved by a
  person. See [Raw-material pricing](#raw-material-pricing).

Both share the same capture, OCR/AI extraction, review and list/export endpoints.

## Architecture

Feature-folder layering, no onion/hexagonal ceremony (see `src/expenses/` as the reference shape):

- `*.routes.ts` — Express wiring only
- `*.controller.ts` — parses `req`, calls the service, shapes the response
- `*.service.ts` — business logic (dedupe, status transitions, orchestrating n8n)
- `*.repository.ts` — the only place that touches Prisma for that feature

`src/auth/` owns identity: email/password login, JWT issuance, and `requireAuth`/`requireRole`
middleware that attach `req.actor` (`{ userId, organizationId, role }`). Every other module
only ever reads `req.actor` — it doesn't know or care how the request got authenticated.
`User.managerId` is the approval-routing mechanism: your approver is your manager, checked
against `role` (must be `APPROVER`/`ADMIN`) at submit time.

Three exceptions get ports/adapters instead of plain layering, because all three are known
to change providers later: `src/expenses/ports.ts` defines `InvoiceExtractor` (document/OCR
extraction — still named for what it extracts, not the entity it's attached to),
`FileStorage`, and `DistanceCalculator` (mileage distance); `src/expenses/adapters/`
holds today's implementations (`direct-extractor.ts` — Mistral OCR + an LLM via `src/ai/gateway/`, the default; `n8n-extractor.ts` as a fallback with `INVOICE_EXTRACTOR=n8n`; `local-disk-storage.ts`,
`s3-file-storage.ts`, `google-directions.ts`, plus `unconfigured-distance-calculator.ts` as
the no-op fallback when `GOOGLE_DIRECTIONS_API_KEY` isn't set). `expenses.routes.ts` is the
composition root — it's the only place that picks which adapter to use, via constructor
injection into `createExpensesService`. Swapping n8n for another extractor, or Google
Directions for another mapping provider, means writing one new adapter class and changing
the composition root — nothing else in the app imports n8n or the Google API directly.

`src/accounting/` follows the same pattern for sending purchase invoices: `ports.ts` defines
`AccountingConnector` (`send(invoice) → { reference }`), `connectors/` holds the
implementations (`no-accounting-system.ts` for `NONE`, `asr.ts` for `ASR`), and `registry.ts`
maps `Organization.accountingConnector` to one. Adding an accounting system means one new
connector plus one registry entry. See [Accounting systems](#accounting-systems).

`src/currency/` does the same for exchange rates: `ports.ts` defines `CurrencyConverter`,
`connectors/` holds `frankfurter.ts` (`FRANKFURTER`, the default) and `free-market.ts`
(`FREE_MARKET`, selectable but not connected yet — every call fails with a clear message), and
`registry.ts` maps `Organization.currencyConverter` to one. Both receipt conversion and
material pricing use the organization's choice.

`src/countries/` holds the country profiles (`INTL`, `IR`), picked by `Organization.country`:
calendar, extra currency units (Toman → stored as Rial ×10), and the country-specific
instructions the extraction prompts get. `src/ai/` holds the extraction pipeline used by
`direct-extractor.ts` (OCR + LLM gateways, prompts, post-extraction checks, the handwritten
path through the vision model).

`FileStorage` already has two adapters and is picked at boot by `FILE_STORAGE_PROVIDER`
(`local`, the default — writes under `UPLOADS_DIR`; or `s3` — any S3-compatible bucket, see
`S3FileStorage`'s doc comment and `.env.example` for the `S3_*` vars). Same interface either
way (`save()` returns an opaque stored-path string, `read()` takes it back), so nothing else
in the app knows or cares which one is active. File access is always private, proxied
through this app's own authenticated `/api/expenses/:id/file` route — neither adapter ever
hands out a public URL, so this holds regardless of provider.

## Data model

`Expense.expenseType` discriminates what kind of expense a row is. `RECEIPT` (document
capture + OCR) and `MILEAGE` (distance-based) are fully implemented; `PER_DIEM`, `GENERAL`
are reserved in the enum so adding them later is additive, not a migration — the
type-specific fields (`filePath`/`vendorName`/`invoiceNumber`… for receipts,
`mileageDate`/`mileageFrom`/`mileageTo`/`mileageDistanceKm`/`mileageRoundTrip` for mileage)
are all nullable for exactly this reason. The approval workflow (`Approval`, status
lifecycle) is entirely generic — it doesn't know or care what `expenseType` it's approving.

`PURCHASE_INVOICE` uses the same row and fields as `RECEIPT`, plus `sentToAccountingAt`,
`accountingRef` (the id the accounting system returned) and `accountingError` (the last
failed send, kept so the accountant can fix and retry). Purchase invoices are shared by the
organization's accountants and admins; employees and approvers never see them.

For mileage, `mileageDistanceKm` always stores the one-way distance; `totalAmount` is
always derived server-side as `distanceKm × (roundTrip ? 2 : 1) × Organization.mileageRatePerKm`,
both on creation and on every `PATCH` — the client can never set `totalAmount` directly for
a mileage expense, so an edit can't accidentally double- or halve-count the round trip.
Distance can be entered directly (`distanceKm`) or calculated from `from`/`to` addresses via
the `DistanceCalculator` port; until `GOOGLE_DIRECTIONS_API_KEY` is set, the calculated path
returns a clear 400 telling the caller to enter the distance manually — manual entry always
works with zero configuration.

## Status lifecycle

`EXTRACTED` (OCR done, needs review) → `SUBMITTED` (routed to your manager) →
`APPROVED` / `REJECTED` (rejected is editable and re-submittable). `FAILED` means
extraction itself errored or came back empty — still editable and submittable by hand.
No separate "reviewed" state: editing and submitting are two different actions
(`PATCH` then `POST /submit`), not two different statuses.

Purchase invoices skip approval: `EXTRACTED`/`FAILED` → `SENT` via `POST /:id/send`. A
failed send keeps the status and stores `accountingError`. A sent invoice is locked against
edits and can't be sent twice.

Roles: `EMPLOYEE`, `APPROVER`, `ACCOUNTANT` (purchase invoices only; no user or settings
access), `ADMIN`.

## Local setup

```bash
cp .env.example .env          # adjust ports if they collide with other local services
docker compose up -d          # Postgres
npm install
npm run prisma:migrate        # creates tables
npm run prisma:seed           # default Organization/User/Categories
npm run dev                   # http://localhost:4300
```

## Endpoints

Auth (`/api/auth`) — login is public, everything else requires a Bearer token:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | email + password → JWT |
| GET | `/api/auth/me` | current actor |
| GET | `/api/auth/users` | list users in the org |
| POST | `/api/auth/users` | create a user (ADMIN only) |
| PATCH | `/api/auth/users/:id` | edit a user (ADMIN only) |
| DELETE | `/api/auth/users/:id` | deactivate a user (ADMIN only) |

Expenses (`/api/expenses`) — all require auth; expenses are scoped to the caller's own
unless `ADMIN`, purchase invoices are shared between accountants/admins. Pass
`module=EXPENSES|PURCHASE_INVOICES` to the list, and `expenseType=PURCHASE_INVOICE` on upload:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/expenses` | multipart upload (field `file`) → OCR + AI extraction → persists → returns Expense |
| POST | `/api/expenses/mileage` | create a MILEAGE expense — `distanceKm` directly, or `from`/`to` to calculate it |
| POST | `/api/expenses/mileage/distance` | preview distance/duration for `from`/`to` without creating an expense |
| GET | `/api/expenses/mileage/rate` | current org's mileage reimbursement rate (for the FE's live total preview) |
| GET | `/api/expenses/currencies` | org's default currency + the list of currencies conversion supports |
| GET | `/api/expenses/language` | org's default UI language + the list of languages the FE supports |
| GET | `/api/expenses` | list, filters: `status`, `search`, `page`, `pageSize` |
| GET | `/api/expenses/:id` | single expense detail |
| GET | `/api/expenses/:id/file` | the original uploaded document (RECEIPT type only) |
| PATCH | `/api/expenses/:id` | edit fields (uploader; any accountant/admin for a purchase invoice) — no status here |
| DELETE | `/api/expenses/:id` | delete a draft, failed or rejected expense (same rule as editing) |
| POST | `/api/expenses/:id/send` | send a purchase invoice to the org's accounting system (ACCOUNTANT/ADMIN) |
| POST | `/api/expenses/:id/submit` | send to the submitter's manager for approval |
| POST | `/api/expenses/:id/approve` | approve (APPROVER/ADMIN, must be the assigned approver) |
| POST | `/api/expenses/:id/reject` | reject with a required `comment` (same role/assignment check) |
| GET | `/api/expenses/approvals/queue` | expenses awaiting the caller's decision |
| GET | `/api/expenses/export?status=…` | CSV export |
| GET | `/api/categories` | category list for the FE dropdown |
| GET | `/api/country` | the org's country profile (calendar, handwritten option) — any signed-in user |
| GET | `/api/modules` | the org's enabled modules — any signed-in user |

Raw-material pricing (`/api/pricing`) — the `RAW_MATERIAL_PRICING` module, ACCOUNTANT/ADMIN
(checked in the service):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pricing/series` | the index categories, for the "change category" picker |
| GET | `/api/pricing/materials` | materials with their match, suggestion and pending price proposal |
| POST | `/api/pricing/materials` | add a material (`name`, `unit`, `price`, `priceDate`) → AI suggests a category |
| POST | `/api/pricing/materials/sample` | add the POC's sample materials (Persian names, Rial prices) |
| PATCH | `/api/pricing/materials/:id` | rename (asks the AI again) or set the price by hand |
| DELETE | `/api/pricing/materials/:id` | delete a material and its proposals |
| POST | `/api/pricing/materials/:id/rematch` | ask the AI again |
| POST | `/api/pricing/materials/:id/confirm-match` | `{ seriesId }` (or `null` = no index fits) |
| POST | `/api/pricing/run` | compute today's proposals for every material with a confirmed category |
| POST | `/api/pricing/proposals/:id/approve` | the proposed price becomes the current price |
| POST | `/api/pricing/proposals/:id/reject` | drop the proposal |

Organization (`/api/organization`) — every route is ADMIN only (`requireAuth` + `requireRole('ADMIN')`
applied once at the router mount in `app.ts`, not per-route):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/organization/settings` | current org settings (`mileageRatePerKm`, `defaultCurrency`, `defaultLanguage`, `country`, `modules`, `accountingConnector`, plus the `supported*` lists for each) |
| PATCH | `/api/organization/settings` | update org settings — any one field, or several at once (incl. `currencyConverter`, `materialMatcher`) |

## Multi-currency

Extracted receipts get auto-converted into `Organization.defaultCurrency` if the extracted
currency differs, using the organization's currency converter (Settings → Currency; by
default [Frankfurter](https://frankfurter.app) (a free, no-API-key wrapper
around the ECB's daily reference rates — no env var needed, it just works)). The rate used is
the one for the **invoice's own date**, not the upload date — uploading a receipt a few days
late still gets the rate that applied when the purchase happened, not today's. Frankfurter
handles weekends/holidays itself (falls back to the nearest prior business day and reports
which date it actually used); falls back to today's rate if the invoice date couldn't be
extracted. The original captured currency/amounts are preserved (`Expense.original*` fields,
written once at extraction, never touched by later edits) so the FE can offer "use the
original" as a one-click revert. A conversion failure (FX API unreachable, unsupported
currency) never blocks the upload — the expense is simply saved with its original currency
untouched. Editing `currency`/`totalAmount`/etc. afterward via `PATCH` is a plain manual edit
and does **not** retrigger conversion — conversion only ever happens automatically once, at
extraction time. Mileage expenses are always tagged with the org's `defaultCurrency`
directly (no conversion needed — the rate-per-km is already denominated in it).

## Accounting systems

Chosen per organization in Settings → Accounting system (`Organization.accountingConnector`,
shown only when `PURCHASE_INVOICES` is enabled). Only the backend talks to the accounting
system; the frontend calls `POST /api/expenses/:id/send` and never sees a key.

| Id | What sending does |
|---|---|
| `NONE` (default) | Marks the invoice as sent; nothing leaves the app. `accountingRef` stays empty. |
| `ASR` | `POST {ASR_BASE_URL}/api/partner/manual-invoice` with the `X-API-Key` header. ASR creates a **draft** purchase invoice; its id is stored in `accountingRef`. |

ASR is configured with `ASR_BASE_URL`, `ASR_API_KEY` and `ASR_TIMEOUT_MS` (default 30000) —
global env vars, not per organization. Things to know about its API, and how
`connectors/asr.ts` handles them:

- **Rial only.** Invoices that aren't in IRR, or have no vendor or date, are refused before
  calling ASR.
- **The total is the sum of the lines.** There is no discount or tax field. Tax is sent as an
  extra line ("مالیات و عوارض ارزش افزوده") when lines + tax match the total. If the lines
  still don't add up to the invoice total (within 1 Rial) — typically a discount — the send
  is refused with a message asking the accountant to correct the lines or the total.
- **No duplicate check** on ASR's side: every successful call creates a new draft. We only
  send an invoice once (status `SENT`); after a timeout, check in ASR before retrying.
- A business failure comes back as HTTP 200 with `succeed: false`; its message is shown to
  the user and stored in `accountingError`.
- Text longer than ASR's limits is shortened (vendor 200, title 50, description 200, line
  description 100 characters). More than 999 lines is refused.
- The ASR address is plain HTTP for now, so call it only from a trusted network.

Tests: `test/asr-connector.test.ts` (mapping and HTTP behaviour, with `fetch` mocked — no
real calls to ASR).

## Raw-material pricing

Proof of concept for an Iranian ERP client whose raw-material prices should follow the market.
A material's price follows a **price index** (how the US price of its category moved) and the
**exchange rate**, from the last approved price:

```
newPrice = previousPrice × (index now / index then) × (USD rate now / USD rate then)
```

- **Index data** comes through the `PriceIndexSource` port (`src/pricing/ports.ts`). Today:
  `adapters/sample-price-index-source.ts` — **sample data**, a category tree shaped like the
  US Producer Price Index (BLS) with generated monthly values. Replace it with a BLS adapter
  once the API is confirmed; BLS publishes monthly, about two weeks after the month ends.
- **Exchange rates** come from the organization's currency converter (USD → the material's
  currency, on the old price's date and today).
- **Matching** a material name to an index category is done by the organization's
  `MaterialMatcher` (`src/pricing/matchers/`, chosen in Settings → Raw-material pricing):
  - `LLM` — the AI gateway's LLM (`LLM_*` env vars); answers with an id, a confidence and a reason.
  - `JEV` — TypeSafe AI's Jev decision model (`JEV_*` env vars): one `choice` question with
    every category as an option (max 254), answered with calibrated probabilities. Built from
    the request shape third parties document (`POST {JEV_BASE_URL}/v1/systemone`); verify it
    against TypeSafe's reference when a key is available.
  - `COMBINED` — Jev first; below `MATCHER_COMBINED_MIN_CONFIDENCE` (or when Jev fails) the LLM
    decides, and a disagreement is noted in the reason.

  Before any AI call, a material whose name matches a confirmed one (ignoring Arabic/Persian
  letter and digit variants, spacing and punctuation) reuses that decision. Confirmed matches
  are also sent to the matcher as examples. The POC gives every category to the matcher; with
  the full BLS list, an embedding search would first narrow it to the closest candidates.
- **People decide.** `RawMaterial.seriesId` is the category a person confirmed; the AI's
  answer is kept apart (`suggested*`). Renaming a material asks the AI again, but the price
  keeps following the confirmed category until the new suggestion is accepted (a
  spelling-only rename keeps the match without asking). Each price change is a
  `MaterialPriceProposal` that a person approves or rejects; moves under 3 %
  (`PRICE_CHANGE_THRESHOLD`) aren't proposed. At most one proposal per material is pending.
- `POST /api/pricing/run` is the daily job, run by hand in the POC. Approved prices stay in
  this app; sending them to the ERP comes later.

Tests: `test/pricing.service.test.ts`, `test/material-matchers.test.ts` (Jev with `fetch` mocked).
