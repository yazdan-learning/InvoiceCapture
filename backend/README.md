# Expense Management Backend

Express + TypeScript + Prisma/PostgreSQL API. Persists expenses submitted from the frontend
(today: receipts/invoices captured and OCR'd via n8n; mileage/per-diem/general reserved for
later), routes them through a submit → approve/reject workflow, and exposes list/review/export
endpoints.

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
holds today's implementations (`n8n-extractor.ts`, `local-disk-storage.ts`,
`s3-file-storage.ts`, `google-directions.ts`, plus `unconfigured-distance-calculator.ts` as
the no-op fallback when `GOOGLE_DIRECTIONS_API_KEY` isn't set). `expenses.routes.ts` is the
composition root — it's the only place that picks which adapter to use, via constructor
injection into `createExpensesService`. Swapping n8n for another extractor, or Google
Directions for another mapping provider, means writing one new adapter class and changing
the composition root — nothing else in the app imports n8n or the Google API directly.

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

Expenses (`/api/expenses`) — all require auth; scoped to the caller's own expenses
unless `ADMIN`:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/expenses` | multipart upload (field `file`) → calls n8n → persists → returns Expense |
| POST | `/api/expenses/mileage` | create a MILEAGE expense — `distanceKm` directly, or `from`/`to` to calculate it |
| POST | `/api/expenses/mileage/distance` | preview distance/duration for `from`/`to` without creating an expense |
| GET | `/api/expenses/mileage/rate` | current org's mileage reimbursement rate (for the FE's live total preview) |
| GET | `/api/expenses/currencies` | org's default currency + the list of currencies conversion supports |
| GET | `/api/expenses/language` | org's default UI language + the list of languages the FE supports |
| GET | `/api/expenses` | list, filters: `status`, `search`, `page`, `pageSize` |
| GET | `/api/expenses/:id` | single expense detail |
| GET | `/api/expenses/:id/file` | the original uploaded document (RECEIPT type only) |
| PATCH | `/api/expenses/:id` | edit fields (uploader only) — no status here |
| POST | `/api/expenses/:id/submit` | send to the submitter's manager for approval |
| POST | `/api/expenses/:id/approve` | approve (APPROVER/ADMIN, must be the assigned approver) |
| POST | `/api/expenses/:id/reject` | reject with a required `comment` (same role/assignment check) |
| GET | `/api/expenses/approvals/queue` | expenses awaiting the caller's decision |
| GET | `/api/expenses/export?status=…` | CSV export |
| GET | `/api/categories` | category list for the FE dropdown |

Organization (`/api/organization`) — every route is ADMIN only (`requireAuth` + `requireRole('ADMIN')`
applied once at the router mount in `app.ts`, not per-route):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/organization/settings` | current org settings (`mileageRatePerKm`, `defaultCurrency`, `defaultLanguage`, `supportedCurrencies`, `supportedLanguages`) |
| PATCH | `/api/organization/settings` | update org settings — any one field, or several at once |

## Multi-currency

Extracted receipts get auto-converted into `Organization.defaultCurrency` if the extracted
currency differs, using [Frankfurter](https://frankfurter.app) (a free, no-API-key wrapper
around the ECB's daily reference rates — no env var needed, it just works). The rate used is
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
