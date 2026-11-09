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

One uploaded file can hold several invoices (a scanner app's PDF of a few receipts). The first
reading reports `invoiceCount`; when it is above 1, one more call reads them apart
(`invoiceSplitPrompt`) and each is saved as its own expense with the same `filePath`. That call
goes to the vision model with the page photos (up to 8, the scanner app's repeated logo left
out), not the OCR text: OCR returns a page of receipts photographed side by side as a picture,
drops columns and moves amounts to the wrong line. The text split is the fallback. The
upload response's `alsoCreated` lists the other ids, and deleting one keeps the file while
another still uses it. If they can't be read apart, the first is kept with a warning.

Iran only (the profile's `extraFields`): a bank transfer receipt scanned with the invoice
(رسید انتقال وجه, کارت به کارت) is the proof of payment, not an invoice, so it is never split
off. Its printed amount, date and payee come back as `transfer` and the reading is checked
against them (`fitToPaidAmount`): handwritten amounts that lost zeros or never say Toman or
Rial are fitted to the amount paid, a misread Shamsi year falls back to the payment date, a
printed reading that doesn't match is re-read once with the photo, and a file in which only
the transfer could be read is saved as the payment. In a split file, the invoices that add up
to the transfer (`paidByTransfer`, the only such set) were paid by it and the others are flagged;
when no set does, all are. Each case leaves its own warning. The
vision model gets every page of the PDF (up to 4), not only the largest.

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

The backend needs the shared AI package next to this repo: clone the private repo
`yazdan-learning/ai-packages` into `../ai-packages` (it is installed from
`file:../../ai-packages` until it is published to GitHub Packages) and run `npm install` there
first, which builds it.

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
| GET | `/api/expenses/:id/field-boxes` | template-guided reader only: page sizes, a box per field where it was read (from word positions on the first call, no AI) and `missing` (fields with a value but no box) |
| PUT | `/api/expenses/:id/field-boxes/:field` | template-guided reader only: the user moved, resized or drew a field's box (`{ page, region }`); kept as `USER`, no AI, the value unchanged |
| DELETE | `/api/expenses/:id/field-boxes/:field` | template-guided reader only: remove a field's boxes (it shows as not found) |
| GET | `/api/expenses/:id/pages/:page` | one page of the document as an upright JPEG (the image the boxes refer to) |
| POST | `/api/expenses/:id/read-box` | template-guided reader only: "Read from box", the field's value from the words inside a region the user drew (`{ field, page, region }`, 0–1 fractions); free, no model; `reason` when there is none |
| POST | `/api/expenses/:id/read-region` | template-guided reader only: "Read with AI", the vision model reads one field from a region the user drew (same body) |
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
| PATCH | `/api/organization/settings` | update org settings — any one field, or several at once (incl. `currencyConverter`, `materialMatcher`, `invoiceReader`) |

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
- **ASR doesn't recalculate amounts.** We send `subTotal` = sum of the line totals,
  `discount` = the invoice's `discountAmount` (0 when none) and `total` = subTotal − discount.
  There is no tax field: tax is sent as an extra line ("مالیات و عوارض ارزش افزوده") when
  lines − discount + tax match the total. If the result is more than 1 Rial off the invoice
  total, the send is refused with a message asking the accountant to correct the lines, the
  discount or the total.
- **No duplicate check** on ASR's side: every successful call creates a new draft. We only
  send an invoice once (status `SENT`); after a timeout, check in ASR before retrying.
- A business failure comes back as HTTP 200 with `succeed: false`; its message is shown to
  the user and stored in `accountingError`.
- Text longer than ASR's limits is shortened (vendor 200, title 50, description 200, line
  description 100 characters). More than 999 lines is refused.
- The ASR address is plain HTTP for now, so call it only from a trusted network.

ASR's `GET /api/partner/exchange-rates` (same key) also backs the `FREE_MARKET` currency
converter (`src/currency/connectors/free-market.ts`): rows with base IRR read "1 quote = rate
IRR"; other pairs are crossed through Rial. It has only the latest rates (USD, EUR, CNY
today), so the invoice date is ignored; the response is cached for 5 minutes.

Tests: `test/asr-connector.test.ts`, `test/free-market.test.ts` (mapping and HTTP behaviour, with `fetch` mocked — no
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

## Template-guided reading

`Organization.invoiceReader` (Settings → Invoice reading) picks how invoices are read:
`CLASSIC` is the stable `DirectInvoiceExtractor`, untouched (git tag `extractor-classic-v1`
marks it); `TEMPLATE` is the template-guided reader being built in `src/reading/`. Switching
back is that setting only. So far `TEMPLATE` reads with the same extractor and adds:

- **Field boxes**: the first time the review page opens an invoice, the values as read
  (printed units, rawExtraction.data) are placed on the page images (`page-images.ts`: upright,
  at most 2000 px) and saved as `ExpenseFieldBox` (source `MODEL`; `Expense.boxesLocatedAt`
  marks it done):
  1. **Word positions first** (`word-boxes.ts`, no model): with `TESSERACT_URL` set, each page
     image goes to our Tesseract service (`ai-packages/services/ocr-tesseract`; small pages
     enlarged) in the country's `ocrLanguages` (`fas+eng` for Iran, `eng+deu+tur` otherwise and
     for foreign receipts). Each value is looked up among the words: amounts by value, the copy
     next to its label when printed twice; dates in any common order; IDs without punctuation;
     names and addresses by their words; line items as rows in order down the page, at most 6
     rows past the last one. Not found = not guessed.
  2. **The vision model only when the words aren't enough**: when they place less than half of
     the values (Persian scans and boxed tables — Tesseract garbles their digits —, handwriting,
     which it can't read, blurry photos), one call places the rest, rougher; when it fails the
     word boxes are kept. A field still without a box is listed in `missing` ("Not marked"); the
     user draws it.
  On the Lidl receipts the words placed 37–38 of 38 (no model call); on Persian scans 0–2 of
  6–23, so there the model is called once per invoice, on first open (HELIX: 23 of 23, 4 s).
  The page words are kept in memory (last 20 invoices) for "read from box".
  **PDFs made from text** (e-invoices, exports; no photos inside) are drawn as page images by
  the same service (`/render`, 200 dpi), so they get the viewer, boxes and pick from photo too.
  Their boxes come from the PDF's own words (exact, no OCR); Persian stored backwards in the
  PDF ("لایرس هرامش") is turned around by the service. Without `TESSERACT_URL` they keep the
  "open document" link only.
- **Viewer** (`src/components/DocumentViewer.tsx`): on a laptop the form is on the left and the
  document on the right, pinned while the form scrolls; on a phone the document is pinned
  above the form (it can be hidden) and drawing opens it full screen. Zoom 100–500% (buttons,
  Ctrl/⌘ + wheel, pinch; Safari's page pinch is stopped on the document); it opens showing the
  whole page ("Fit"; a long receipt opens at its width), and choosing a field zooms to its box
  gently (about 26 px tall, at most 250%; on a phone 18 px, at most 160%; never further out
  than the whole page), hovering lights up both; Enter / ⌘+Enter (Ctrl+Enter on Windows) moves to the next /
  previous field or line item. The chosen box can be dragged to move, its corners to resize (pointer events: mouse,
  finger, pen), or nudged with the arrow keys; it is then saved as the field's `USER` box. Its
  bar offers Redraw, Read from box (free), Read with AI and Remove. Each field shows a chip:
  on document, set by you, not marked (click to draw), check. "Review
  now" steps through what the checks found (line checks, handwritten fields), zooming to each.
  "Enlarge" shows the document over the page (Esc closes). A scanned PDF under 150 dpi
  (pixels against its MediaBox paper size) gets `lowResolutionDpi` and a "rescan sharper" note.
- **Invoice templates** (`templates.ts`, `templates.repository.ts`, `InvoiceTemplate`): where a
  vendor's fields are on its page, as 0–1 page fractions, plus the line-items table (rows of
  `rowHeight` from its top). Layout only — no values, customers, amounts or page images — so
  templates are **shared with every organization** (`Organization.shareTemplates`, default on):
  a new client's first invoice from a vendor uses what other clients taught.
  - **Learned when an invoice is sent** (or an expense submitted; not on Save):
    `learnTemplate` takes its final boxes (the user's, else found, else the template's) and
    creates or updates the organization's own template for the vendor (fields the invoice
    lacked keep the template's; fields whose box the user **removed** on it — recorded in
    `Expense.removedBoxFields`, cleared when a box is drawn again — are dropped). The template it used counts one more use, and one more
    correction when the user moved a box. The send response carries `templateLearned` for the
    "template saved / updated" note. A learning failure never fails the send.
  - **Used on first open** (step 1: found by the vendor's tax ID digits, else its normalized
    name): the organization's own first, else a shared one; most trusted wins (sent often,
    rarely corrected). Only when the pages have its shape (height ÷ width within 12%).
    Words first (exact), the template for what they missed (`source: TEMPLATE`), the vision
    model only if together they place under half. HELIX TOOLS: 23 of 23 from the template,
    0.5 s, no model call. The template places **every** field it knows, also ones the reading
    left empty, and stores what each of its boxes holds (`value`, from the words inside, only
    when the OCR is sure: average confidence ≥ 0.8; a text PDF's words always). The response's
    `templateValues` give those in the form's units; the review page flags a field as
    "Check" when the box holds a value the field lacks or a different one (Use it / Ignore), or
    when the template expects a value and none was read.
  - **Found by the form** (step 2, `template-match.ts`; all free) when the vendor finds none
    (name misread, handwritten, a vendor new here), in this order:
    1. the vendor's template — skipped when its printed words are missing from a page that has
       plenty (≥ 30 sure words, < 15 % of its words: another of the vendor's forms); with several
       forms of a vendor, the one whose words are on the page;
    2. **printed words**: the form's fixed words (labels, form code, the vendor's own address —
       words the OCR is sure of, with letters, once on the page, outside every value box and
       the items table), kept in `words` with how many of the template's `samples` showed them
       (kept while seen on at least half). A template matches when ≥ 40 % (and ≥ 6) of its
       words sit where one alignment puts them; others' common labels ("Total", "تاریخ")
       scattered elsewhere don't count;
    3. **page look** (`look`): the first page's ink-edge density on a 48×48 grid and its
       row/column profiles — a fingerprint, too coarse to show text. ≥ 0.7 is the same form
       (other forms measured ≤ 0.64, same form shifted 0.87–0.98; a stationery-shop
       "فاکتور فروش" pad filled in by different vendors 0.55–0.89). For handwritten and blurry
       scans, whose words Tesseract can't read (1–8 sure words on such photos).
    Ways 2–3 need a **clear winner** (a template of another layout scoring within 0.1 / 0.05
    means none; templates of the same layout — several vendors on one printed form — don't
    compete) and skip **distrusted** templates (sent ≥ 2 times, corrected on most). Candidates:
    templates whose first page has the shape (`firstPageAspect`, indexed), latest 300.
    `Expense.templateMatch` (`vendor` / `words` / `look`) reaches the review page as
    `template.matchedBy`; found by the form, the note says so (maybe another vendor's
    template of the same form). A handwritten invoice's words are read only for this.
  - **Aligned to the scan**: the matched words give each page's shift and zoom (robust fit,
    zoom 0.85–1.18), else the look's row/column profiles the shift; boxes and table rows move
    with it. On learning, the template's kept boxes and words are moved into the new
    invoice's place before merging, so old and new agree.
  - **Another form, not an update**: a trusted template (sent ≥ 2, not distrusted) whose boxes
    nearly all moved on a sent invoice, or whose printed words are missing, stays as it is;
    a new template is created for the vendor's other form.
  - **Guiding the reading on upload** (step 3, `template-extractor.ts`, `template-guide.ts`):
    before the AI reading, the template is found the same way (`template-finder.ts`, shared
    with the review page), with the vendor taken from the Mistral OCR text — every tax-ID-like
    digit run and every run of up to four words (`taxIdsInText`, `vendorKeysInText`, across
    lines: "HELIX" over "TOOLS") looked up at once; several vendors in the text (the customer
    is one too) are told apart by the form. Tesseract runs only when a candidate template needs
    its words; handwritten invoices (no OCR first) are found by the form. The reading's prompt
    gets `ExtractOptions.hints` (`templateHints`: the likely vendor — or "same printed form,
    the vendor may differ" — each field's place and the printed words beside it, the items
    table; the document wins where it differs). The classic reader adds hints only when
    given; CLASSIC never gets any.
    - **Checked** (`checkGuidedReading`, free): every box whose words Tesseract is sure of
      agrees with the value read (amounts, dates, invoice number; Persian digits = Western),
      the vendor is the template's when found by the vendor, total/date/number are there when
      the template has them, the lines add up, one invoice. Any problem → read again without
      the template, and that reading is used (`fell-back`).
    - **New templates** (`isTrusted`: fewer than 3 sends without corrections): both readings
      are made at once, the plain one is used, and `differences` keeps where they differ
      (`compared`; costs a second call until trusted).
    - `rawExtraction.template.match` = `{ id, by, vendorName, outcome: used | fell-back |
      compared, problems, differences? }`; the log says the same (`template reading: …`). The
      review page places its boxes from that template unless the reading fell back.
    - Live, HELIX TOOLS and the NOVA STEEL copy (same form, other vendor): found by vendor in
      the OCR text, no problems, guided = plain reading; trusted: 1 call, `used`.
    - **Correction counting** (`correctedTemplate`): only a template box the user moved
      clearly elsewhere (centre > 0.02) or removed counts against trust; a box drawn where the
      template's was (to fill the field) or for a field it lacked doesn't.
  - **The user's choices become rules** (`InvoiceTemplate.chosen`, `chosenFields`, counts
    only): when a sent invoice's text field (invoice number, vendor name / tax ID / address)
    was changed from what was read (`Expense.initialReading`) to the text of a box the user
    drew, that field counts once more (from one again when the box is elsewhere; typed
    without a box: the rule is dropped). From `RULE_AFTER` = 2 the hint becomes a RULE ("take
    exactly the value printed there, even when another seems to fit better"), the box check
    skips it, and `withRuledFields` takes the box's words when Tesseract is sure of them
    (≥ 0.8; small print on a low-res scan reads as garbage, "F-LO-005" → "T 303").
    `match.ruled` lists the fields set so. Each rule keeps the **label** printed before the
    chosen value in the OCR text (`labelBefore`; amounts by their digits with any separators,
    skipping line items' names): the hint says "the value right after 'شماره خروج'" and
    `valueAfter` takes it from the OCR text, exact. Amounts (total, subtotal, tax, discount)
    can be rules too. Rules are applied before the checks.
  - **Text readings get no places**: the model reading OCR text can't use "15 % down", and
    with places (and Tesseract's guessed Persian labels) it dropped a receipt's line items;
    a text reading gets the vendor and the user's rules only, plus "read every other value
    and line item as usual". Places are given when the model sees the page (handwriting,
    the image fallback).
  - **OCR that missed part of a known form** (`completeOcrText`): Mistral OCR now and then
    skips part of a page (ونوس شیشه: 12 of 17 uploads read "هزینه مازاد" as 45,000,000 and
    dropped "هزینه کل" → total 90,000,000). The labels of the template's rules
    (`requiredLabels`) are printed on every invoice of the form; text without one is OCRed
    again (up to 2 more calls, the text missing the fewest kept), and still missing, the
    vision model reads the page image with the OCR text and what it missed
    (`readFromImage`). `template.ocrRetries`, `template.ocrMissing`. Live, with a total rule
    "after هزینه کل": 3 of 3 readings 45,000,000.
  - **Form guide** (`form-guide.ts`, `InvoiceTemplate.guide`): on every send, not only on
    corrections, the printed label before each confirmed value is found in the invoice's OCR
    text (`learnGuide`; number, dates, tax ID and amounts, in printed units; a value alone in
    a table cell takes the cell before it). A total printed after several labels takes the one
    with a total's words ("کل", "جمع", "پرداخت", "Summe", …), else the last. Also learned: the
    labelled amounts with the total's first word that add up to it ("هزینه پایه + مازاد +
    تخلیه = هزینه کل"), and the label of what the reading wrongly took for a corrected field
    ("not after شماره قرارداد"). A value not printed in the text (a wrong total sent) teaches
    nothing. A label counts from 2 sends on and when it has most of the field's sightings
    (`learnedLabel`). It goes into the text model's prompt ("How this form prints its
    values"), its fields are checked against the value printed after the label
    (`guideProblems`, a failed check falls back), and the total/number/date labels count as
    always printed for the OCR check. Labels and counts only: shared with the template.
  - **Cheaper model** (`LLM_MODEL_TEMPLATE`, e.g. `mistral-small-latest`; empty = the usual
    model): a trusted template with a learned guide or a rule is read with it from the OCR
    text (`match.cheapModel`); a failed check reads again with `LLM_MODEL_FAST`. Live:
    ونوس 2 of 3 cheap only (the 3rd misread the date, caught, read again), HELIX 2 of 2.
  - Next: crops of the boxes read by a smaller model.
- **Drawing a box fills the field** (`read-box`, `box-text.ts`, no model): the words whose centre
  lies in the box, in reading order (right to left for Persian lines), from the page words read
  on open, else a text PDF's own words, else Tesseract on just that region. An amount is the
  last number in it ("Summe 16,72" → 16.72, "-0,40", "۲٬۳۹۰٬۰۰۰"), a date the first date (day
  first as printed in Europe, year first, Shamsi converted). Then converted to the form's units
  (Toman as Rial, the exchange rate when converted). Nothing for handwriting, an empty box or
  without `TESSERACT_URL` (`reason`); the form offers Undo after a fill.
- **Read with AI** (`read-region`, one vision-model call, only on that button): the model sees
  the region framed in red with a margin of the page around it, so its label shows (a fraction
  of the whole page); for a handwritten invoice the whole page with the region framed and the
  region enlarged, plus the country's handwriting rules. It always reads the value, and says
  when the framed text is clearly something else (`looksLike`: e.g. `customerName` framed as
  the vendor address); the page then shows "This looks like the customer's name, not the
  vendor address" under the field with **Read anyway** (fills the value already read). Same unit conversion; a total that lost trailing zeros is fitted to
  the line items. The region is kept as the field's `USER` box.

- **Shared checks** (`template-extractor.ts`, from `@yazdan-learning/ai`, the
  package shared with Nestmate): a photo under 600 px on its short side is enlarged 2× (for the
  OCR and the re-read; the stored file stays the original), then the file is OCR'd first; a receipt without Persian text in an
  Iranian organization is read with the international rules. VAT codes read as quantities
  (dm's "2,95 2") are taken out when the total and every VAT group then add up.
  The tax and net amounts come from the VAT table when every row adds up and the gross amounts
  equal the total (the model's own tax may only add up); a table that disagrees with the reading
  gets `TAX_UNCHECKED`. With
  `LLM_MODEL_LARGE` set, an invoice that still doesn't add up gets one last look with that
  model. One that is far off its total gets `AMOUNTS_FAR_OFF` instead of `AMOUNTS_UNCHECKED`.
  Handwritten invoices are read as in `CLASSIC` (vision model plus OCR alongside), with a small
  photo enlarged. In a file with several invoices, each one gets the far-off warning (the
  VAT-code fix and the last look are for single invoices). `rawExtraction.template.mode` says
  which path was taken (`printed`, `handwritten`, `several`). `CLASSIC` uses the same package for
  its gateway and checks, with its behaviour unchanged.
- **Line checks** (`GET /api/expenses/:id/reading-checks`): per line item, quantity × unit
  price, and when the items are a little off the total, the likely misread digit (checked
  against the printed savings). The review page shows them with one click to use the price.

Every upload also keeps `Expense.initialReading`, what the AI read, so it can be compared with
what the user saved.

Scripts: `scripts/eval-extract.ts` scores readings against confirmed invoices (free on stored
readings; `--rerun` reads the files again, at the cost of one reading each);
`scripts/try-boxes.ts --out=<folder> <expenseId>...` draws the located boxes on the pages.

Tests: `test/reading.test.ts` (vision model and word OCR faked), `test/word-boxes.test.ts`.
