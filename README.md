# InvoiceCapture

Captures invoices and receipts from a photo or PDF, reads them with OCR and an LLM, and lets
a person check the result before it goes anywhere. One codebase serves two uses, switched on
per organization (Settings → Modules):

- **Expenses** — employees capture receipts and mileage, their manager approves or rejects,
  the company reimburses. Rydoo-style.
- **Purchase invoices** — the accountant captures supplier invoices, checks them, and sends
  them to the company's accounting system. No approval step, no payment tracking (that lives
  in the accounting system).
- **Raw-material pricing** (proof of concept) — raw materials as named in the company's ERP
  (often Persian) are matched by AI to a price-index category; their prices are recalculated
  from the index and the exchange rate, and a person approves each new price.

An organization can use any combination of the modules.

## Repository layout

| Folder | What it is |
|---|---|
| `src/` | React 18 + TypeScript + Vite frontend |
| `backend/` | Express + TypeScript + Prisma/PostgreSQL API — see [backend/README.md](backend/README.md) |
| `mock-backend.js` | Old mock server (`npm run mock:server`), not needed with the real backend |

## Main features

- Upload by drag & drop, file picker or phone camera (JPEG, PNG, WebP, PDF).
- Extraction in the backend: Mistral OCR + an LLM; handwritten invoices go to a separate
  vision model.
- **Country profiles** (per organization): `INTL` (default) and `IR` (Iran — Shamsi
  calendar and date picker, Rial/Toman, Persian prompts, "handwritten" option on upload).
- Multi-currency: receipts are converted into the organization's currency at the invoice
  date's rate; the original amounts are kept. Exchange rates come from the source chosen in
  Settings → Currency (Frankfurter, or the free-market rate from ASR — USD, EUR and CNY against Rial, latest
  rates only).
- Material matching: the AI that matches raw materials to index categories is chosen in
  Settings (an LLM, TypeSafe's Jev, or Jev with the LLM as a fallback).
- Roles: `EMPLOYEE`, `APPROVER`, `ACCOUNTANT` (purchase invoices only), `ADMIN`.
- **Send to accounting**: per organization, Settings → Accounting system:
  - `NONE` — sending only marks the invoice as sent.
  - `ASR` — creates the invoice as a draft in ASR through its partner API (see the
    backend README).
- Amounts are shown and typed with thousands separators; line items are shown as a list on
  mobile.
- UI languages: English, German, Polish, Turkish.
- Mileage with optional Google Maps autocomplete and route map.

## Running locally

Start the backend first (Postgres in Docker, migrations, seed) — see
[backend/README.md](backend/README.md#local-setup). Then the frontend:

```bash
npm install
cp .env.example .env     # VITE_API_BASE_URL=http://localhost:4300
npm run dev              # http://localhost:5173
```

### Frontend environment

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | The backend's address |
| `VITE_GOOGLE_MAPS_API_KEY` | Optional. Places autocomplete and route map on the mileage forms (Maps JavaScript API + Places API). Without it the From/To fields are plain text. Separate from the backend's `GOOGLE_DIRECTIONS_API_KEY`. |

All other keys (OCR, LLM, accounting systems) live in the backend only; the browser never
calls those services.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type check + production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Type check |
| `npm test` | Frontend unit tests (Vitest) |

## Frontend structure

```
src/
├── App.tsx            # Routes (/expenses, /invoices, /approvals, /admin/…)
├── api.ts             # Client for the backend API
├── pages/             # One file per screen
├── components/        # Shared UI (AmountInput, DateInput, PersianDatePicker, Select, …)
├── auth/              # Login state
├── country/           # Country profile context and date formatting
├── workspace/         # Enabled modules, navigation, role permissions
├── i18n/              # LanguageContext + translations (en, de, pl, tr)
└── lib/               # money formatting, Google Maps loader
```

## Deployment

`npm run build` produces static files in `dist/`. Serve them from any static host (Nginx,
IIS with URL Rewrite, Vercel — `vercel.json` is included) with a fallback to `index.html`
for client-side routes. Build with `VITE_API_BASE_URL` set to the production backend.

## License

Private.
