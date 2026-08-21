# Invoice OCR Backend

Express + TypeScript + Prisma/PostgreSQL API. Persists invoices uploaded from the frontend,
orchestrates extraction via the existing n8n workflow, and exposes list/review/export endpoints.

## Architecture

Feature-folder layering, no onion/hexagonal ceremony (see `src/invoices/` as the reference shape):

- `*.routes.ts` — Express wiring only
- `*.controller.ts` — parses `req`, calls the service, shapes the response
- `*.service.ts` — business logic (dedupe, status transitions, orchestrating n8n)
- `*.repository.ts` — the only place that touches Prisma for that feature

`src/context/currentActor.ts` stands in for auth in v1: every request acts as the single
seeded user/organization. Swap that middleware for real auth later without touching
controllers or services — they only ever read `req.actor`.

Two exceptions get ports/adapters instead of plain layering, because both are known to
change providers later: `src/invoices/ports.ts` defines `InvoiceExtractor` and
`FileStorage`; `src/invoices/adapters/n8n-extractor.ts` and `local-disk-storage.ts` are
today's implementations (n8n, local disk). `invoices.routes.ts` is the composition root —
it's the only place that picks which adapter to use, via constructor injection into
`createInvoicesService`. Swapping n8n for another extractor, or local disk for S3, means
writing one new adapter class and changing two lines there — nothing else in the app
imports n8n or `fs` directly.

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

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/invoices` | multipart upload (field `file`) → calls n8n → persists → returns Invoice |
| GET | `/api/invoices` | list, filters: `status`, `search`, `page`, `pageSize` |
| GET | `/api/invoices/:id` | single invoice detail |
| PATCH | `/api/invoices/:id` | review/correct fields, set `status: "REVIEWED"` |
| GET | `/api/invoices/export?status=REVIEWED` | CSV export |
| GET | `/api/categories` | category list for the FE dropdown |
