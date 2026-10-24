# CLAUDE.md

Guidance for Claude Code in this repository. Product overview: [README.md](README.md).
Backend architecture, data model, endpoints and the ASR integration:
[backend/README.md](backend/README.md) — read it before changing the backend.

## Layout

- `src/` — React 18 + Vite frontend. `src/api.ts` is the only place that calls the backend.
- `backend/` — Express + Prisma/PostgreSQL. Feature folders (`routes → controller → service →
  repository`); ports/adapters only where providers change: `src/expenses/ports.ts` +
  `adapters/`, `src/accounting/ports.ts` + `connectors/`, `src/currency/`, `src/pricing/ports.ts` + `matchers/`
  + `adapters/`, `src/ai/gateway/`.

## Commands

| Where | Command |
|---|---|
| Frontend type check / tests | `npx tsc --noEmit -p .` (or `npm run lint`) / `npm test` |
| Backend type check / tests | `cd backend && npm run lint` / `npm test` |
| Backend dev server | `cd backend && npm run dev` (port 4300) |
| Frontend dev server | `npm run dev` (port 5173) |
| Schema change | `cd backend && npx prisma migrate dev --name <name>` |

The shell is zsh: quote glob patterns (`--include='*.ts'`). `prisma db execute` prints no
rows; to inspect data, run a small `tsx` script with the Prisma client.

## Concepts to keep straight

- **Modules** (`Organization.modules`): `EXPENSES` (approval + reimbursement),
  `PURCHASE_INVOICES` (accountant checks, then sends to accounting) and
  `RAW_MATERIAL_PRICING` (POC, `backend/src/pricing/`: AI matches materials to price-index
  categories, prices follow index × exchange rate, a person approves). Purchase invoices are
  `Expense` rows with `expenseType = PURCHASE_INVOICE` and status `SENT` when done. Don't add
  approval or payment status to purchase invoices — payment lives in the accounting system.
- **Roles**: `EMPLOYEE`, `APPROVER`, `ACCOUNTANT`, `ADMIN`. Permission helpers live in
  `backend/src/auth/permissions.ts` and `src/workspace/permissions.ts`; keep them in step.
- **Country profiles** (`Organization.country`): `INTL`, `IR`, in `backend/src/countries/`.
  Iran: Shamsi calendar, Toman stored as Rial ×10, handwritten upload option.
- **Accounting connectors** (`Organization.accountingConnector`): `NONE`, `ASR`. Add a new
  system as a connector in `backend/src/accounting/connectors/` plus an entry in
  `registry.ts` (`ACCOUNTING_CONNECTOR_IDS` and `ACCOUNTING_CONNECTOR_NAMES`); the frontend
  gets the list from the settings response. A CSV/Excel export connector is planned but
  postponed.
- **Currency converters** (`Organization.currencyConverter`): `FRANKFURTER`, `FREE_MARKET`
  (not connected yet) in `backend/src/currency/`, same registry pattern as accounting.
- **Material matchers** (`Organization.materialMatcher`): `LLM`, `JEV`, `COMBINED` in
  `backend/src/pricing/matchers/`. The price index is sample data
  (`adapters/sample-price-index-source.ts`) until the BLS API is confirmed.
- **Amounts** in the UI go through `src/lib/money.ts` and `AmountInput` (thousands separators).
- **Translations**: every new UI string goes into all four files in `src/i18n/translations/`
  (en, de, pl, tr).

## Rules

- **Secrets**: never print or copy the values of `MISTRAL_API_KEY`, `LLM_API_KEY`,
  `VISION_API_KEY`, `ASR_API_KEY`, `JEV_API_KEY`, `JWT_SECRET` or `GOOGLE_DIRECTIONS_API_KEY` (in
  `backend/.env` or anywhere else). Add new variables to `backend/.env.example` with an empty
  value.
- **ASR is a real system**: each successful send creates a real draft, and ASR has no
  duplicate check. Don't send invoices to ASR (from tests, scripts or the app) without the
  user's agreement. Tests mock `fetch`; the status endpoint is safe to call.
- Only the backend calls third-party APIs (OCR, LLM, ASR); keys never reach the frontend.
- Send failures are stored on the invoice (`accountingError`), not logged.
- Commit only when asked.
