// Scores invoice readings against what the users confirmed: every receipt or
// purchase invoice that was submitted, approved or sent is the truth (its
// saved fields), and the AI's reading is compared with it field by field.
//
//   npx tsx scripts/eval-extract.ts [--org=<id>] [--limit=200] [--json=out.json]
//       Free: scores the readings stored at upload (initialReading; for older
//       invoices the model's JSON in rawExtraction, without the handwriting
//       fixes, so those count as approximate).
//   npx tsx scripts/eval-extract.ts --rerun [--org=<id>] [--limit=20]
//       Reads the files again with today's extractor: costs one OCR/AI reading
//       per invoice (keys from .env). Files holding several invoices are skipped.
//
// The truth is only as good as the review: a wrong value nobody corrected
// counts as right. Line items can't be edited on the review page, so they are
// scored only as "the items add up to the confirmed total".
import { Prisma, PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { env } from '../src/config/env';
import { MistralOcr } from '../src/ai/gateway/mistral-ocr';
import { OpenAiCompatibleLlm } from '../src/ai/gateway/openai-compatible';
import { applyCurrencyUnits, toInvoiceData, westernDigits } from '../src/ai/replies';
import { getCalendar } from '../src/countries/calendars';
import { getCountryProfile } from '../src/countries/registry';
import { DirectInvoiceExtractor } from '../src/expenses/adapters/direct-extractor';
import { LocalDiskFileStorage } from '../src/expenses/adapters/local-disk-storage';
import { S3FileStorage } from '../src/expenses/adapters/s3-file-storage';
import { ExtractedInvoiceData } from '../src/expenses/ports';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const rerun = process.argv.includes('--rerun');
const limit = Number(arg('limit') ?? (rerun ? 20 : 200));
const orgId = arg('org');
const jsonOut = arg('json');

const prisma = new PrismaClient();
const CONFIRMED = ['SUBMITTED', 'APPROVED', 'SENT'] as const;

type Expense = Prisma.ExpenseGetPayload<{ include: { items: true } }>;
type Truth = Record<Field, string | number | null>;
type Field = (typeof FIELDS)[number];
const FIELDS = ['vendorName', 'vendorTaxId', 'invoiceNumber', 'invoiceDate', 'subtotal', 'discount', 'taxAmount', 'totalAmount', 'currency'] as const;
const AMOUNTS = new Set<Field>(['subtotal', 'discount', 'taxAmount', 'totalAmount']);

const n = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

/** The saved fields, in the units of the reading: before currency conversion. */
function truthOf(e: Expense): Truth {
  const converted = Boolean(e.originalCurrency);
  return {
    vendorName: e.vendorName,
    vendorTaxId: e.vendorTaxId,
    invoiceNumber: e.invoiceNumber,
    invoiceDate: e.invoiceDate?.toISOString().slice(0, 10) ?? null,
    subtotal: n(converted ? e.originalSubtotal : e.subtotal),
    discount: n(converted ? e.originalDiscountAmount : e.discountAmount),
    taxAmount: n(converted ? e.originalTaxAmount : e.taxAmount),
    totalAmount: n(converted ? e.originalTotalAmount : e.totalAmount),
    currency: converted ? e.originalCurrency : e.currency
  };
}

/** Persian/Arabic letter forms, digits, spacing and punctuation don't make a reading wrong. */
const normal = (v: string) =>
  westernDigits(v.normalize('NFKC'))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌\s\-_.,،:/\\()]/g, '')
    .toLowerCase();

function same(field: Field, read: unknown, truth: string | number | null): boolean {
  if (truth === null || truth === undefined) return read === null || read === undefined || read === '';
  if (read === null || read === undefined) return false;
  if (AMOUNTS.has(field)) return Math.abs(Number(read) - Number(truth)) < 0.5;
  return normal(String(read)) === normal(String(truth));
}

const isHandwritten = (e: Expense) => (e.rawExtraction as { mode?: unknown } | null)?.mode === 'handwritten';

/** The stored first reading, in stored units (Toman as Rial), and whether it is exact. */
function storedReading(e: Expense, countryId: string): { data: ExtractedInvoiceData; approximate: boolean } | null {
  if (e.initialReading) return { data: e.initialReading as unknown as ExtractedInvoiceData, approximate: false };
  const structured = (e.rawExtraction as { data?: unknown } | null)?.data;
  if (!structured || typeof structured !== 'object') return null;
  const country = getCountryProfile(countryId);
  const data = applyCurrencyUnits(toInvoiceData(structured as Record<string, unknown>, getCalendar(country.calendar)), country.invoice.currencyUnits);
  // Handwritten readings get zeros restored and amounts fitted after the model's answer.
  return { data, approximate: isHandwritten(e) };
}

function extractor() {
  return new DirectInvoiceExtractor(
    new MistralOcr({ ...env.ocr, timeoutMs: env.aiTimeoutMs }),
    new OpenAiCompatibleLlm({ ...env.llm, timeoutMs: env.aiTimeoutMs }),
    env.vision.apiKey ? new OpenAiCompatibleLlm({ ...env.vision, models: { fast: env.vision.model, smart: env.vision.model } }) : undefined
  );
}

type Row = { id: string; slice: string; approximate: boolean; fields: Partial<Record<Field, { read: unknown; truth: unknown; ok: boolean }>>; itemsAddUp: boolean | null };

(async () => {
  const expenses = await prisma.expense.findMany({
    where: { status: { in: [...CONFIRMED] }, expenseType: { in: ['RECEIPT', 'PURCHASE_INVOICE'] }, filePath: { not: null }, ...(orgId ? { organizationId: orgId } : {}) },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
  const countries = new Map((await prisma.organization.findMany({ select: { id: true, country: true } })).map((o) => [o.id, o.country]));
  const storage = env.fileStorageProvider === 's3' ? new S3FileStorage(env.s3) : new LocalDiskFileStorage(env.uploadsDir);
  const reader = rerun ? extractor() : null;

  const rows: Row[] = [];
  let skipped = 0;
  for (const e of expenses) {
    const countryId = countries.get(e.organizationId) ?? 'INTL';
    let reading: { data: ExtractedInvoiceData; approximate: boolean } | null = null;
    if (reader) {
      if ((await prisma.expense.count({ where: { filePath: e.filePath } })) > 1) {
        skipped++;
        continue;
      }
      const buffer = await storage.read(e.filePath!);
      const result = await reader.extract(
        { buffer, originalname: e.filePath!, mimetype: e.mimeType ?? 'application/octet-stream', size: buffer.length },
        { country: getCountryProfile(countryId), handwritten: isHandwritten(e) }
      );
      reading = result.data ? { data: result.data, approximate: false } : null;
      process.stdout.write('.');
    } else {
      reading = storedReading(e, countryId);
    }
    if (!reading) {
      skipped++;
      continue;
    }

    const truth = truthOf(e);
    const fields: Row['fields'] = {};
    for (const field of FIELDS) {
      const read = (reading.data as Record<string, unknown>)[field] ?? null;
      if (truth[field] === null && (read === null || read === '')) continue;
      fields[field] = { read, truth: truth[field], ok: same(field, read, truth[field]) };
    }
    const lines = reading.data.items?.map((i) => i.totalPrice);
    const itemsAddUp =
      lines?.length && lines.every((v) => v !== null) && truth.totalAmount !== null
        ? [0, Number(truth.discount ?? 0)].some((d) =>
            [0, Number(truth.taxAmount ?? 0)].some((t) => Math.abs(lines.reduce((s, v) => s! + v!, 0)! - d + t - Number(truth.totalAmount)) < 0.5)
          )
        : null;
    rows.push({
      id: e.id,
      slice: `${e.expenseType === 'PURCHASE_INVOICE' ? 'invoice' : 'receipt'}/${isHandwritten(e) ? 'handwritten' : 'printed'}`,
      approximate: reading.approximate,
      fields,
      itemsAddUp
    });
  }
  if (reader) process.stdout.write('\n');

  const slices = ['all', ...new Set(rows.map((r) => r.slice))];
  const pct = (ok: number, total: number) => (total ? `${Math.round((100 * ok) / total)}% (${ok}/${total})` : '-');
  console.log(`\n${rerun ? 'Re-read with today\'s extractor' : 'Stored first readings'}: ${rows.length} confirmed invoices${skipped ? `, ${skipped} skipped` : ''}`);
  const approx = rows.filter((r) => r.approximate).length;
  if (approx) console.log(`${approx} handwritten readings are approximate (stored before initialReading existed; handwriting fixes not applied).`);
  const table = [...FIELDS, 'itemsAddUp' as const].map((field) => {
    const line: Record<string, string> = { field };
    for (const slice of slices) {
      const inSlice = rows.filter((r) => slice === 'all' || r.slice === slice);
      const scored =
        field === 'itemsAddUp'
          ? inSlice.filter((r) => r.itemsAddUp !== null).map((r) => r.itemsAddUp!)
          : inSlice.flatMap((r) => (r.fields[field] ? [r.fields[field]!.ok] : []));
      line[slice] = pct(scored.filter(Boolean).length, scored.length);
    }
    return line;
  });
  console.table(table);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
    console.log(`Details per invoice: ${jsonOut}`);
  }
  await prisma.$disconnect();
})();
