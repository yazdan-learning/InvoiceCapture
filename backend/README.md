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

Two exceptions get ports/adapters instead of plain layering, because both are known to
change providers later: `src/expenses/ports.ts` defines `InvoiceExtractor` (document/OCR
extraction — still named for what it extracts, not the entity it's attached to) and
`FileStorage`; `src/expenses/adapters/n8n-extractor.ts` and `local-disk-storage.ts` are
today's implementations (n8n, local disk). `expenses.routes.ts` is the composition root —
it's the only place that picks which adapter to use, via constructor injection into
`createExpensesService`. Swapping n8n for another extractor, or local disk for S3, means
writing one new adapter class and changing two lines there — nothing else in the app
imports n8n or `fs` directly.

## Data model

`Expense.expenseType` discriminates what kind of expense a row is. Only `RECEIPT` is fully
implemented (document capture + OCR); `MILEAGE`, `PER_DIEM`, `GENERAL` are reserved in the
enum so adding them later is additive, not a migration — the document-specific fields
(`filePath`, `vendorName`, `invoiceNumber`, etc.) are already nullable for exactly this
reason. The approval workflow (`Approval`, status lifecycle) is entirely generic — it
doesn't know or care what `expenseType` it's approving.

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
