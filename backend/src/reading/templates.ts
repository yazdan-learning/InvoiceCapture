import { westernDigits } from '../ai/replies';
import { isItemField, isPickableField, itemField } from './fields';
import { LocatedBox } from './vision-fields';

// Invoice templates: where a vendor's (or a form's) fields are on the page,
// learned from an invoice the user sent and used to place the boxes on the
// next one — also for other organizations. A template is layout only: box
// positions in 0–1 page fractions and the vendor's keys; never a value, a
// customer, an amount or a page image.

export type TemplateBox = { page: number; x: number; y: number; width: number; height: number };
/** The line-items table: rows of rowHeight from its top, one per line item. */
export type TemplateItems = TemplateBox & { rowHeight: number };
export type TemplateLayout = { pageAspects: number[]; fields: Record<string, TemplateBox>; items: TemplateItems | null };
export type StoredTemplate = TemplateLayout & {
  id: string;
  organizationId: string;
  shared: boolean;
  vendorTaxId: string | null;
  vendorKey: string | null;
  vendorName: string | null;
  timesSent: number;
  timesCorrected: number;
  updatedAt: Date;
};

/** A page whose height ÷ width differs more than this is another form (or another scan of it, cut differently). */
const ASPECT_TOLERANCE = 0.12;

/** The vendor's tax ID as digits, when long enough to identify a vendor. */
export function taxIdKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = westernDigits(value).replace(/\D/g, '');
  return digits.length >= 5 ? digits : null;
}

/** Words that say what kind of company it is, not which one ("شرکت", "GmbH"): left out of the key. */
const LEGAL_WORDS = new Set(['شرکت', 'فروشگاه', 'گروه', 'موسسه', 'مؤسسه', 'تولیدی', 'بازرگانی', 'gmbh', 'co', 'kg', 'ag', 'ltd', 'inc', 'llc', 'sa', 'srl', 'bv', 'oy', 'ab', 'as', 'aş', 'ltdşti', 'şti', 'the']);

/** The vendor's name, normalized so the same vendor read twice gives the same key (Persian ي/ك, spacing, case, legal words). */
export function vendorKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const words = westernDigits(value.normalize('NFKC'))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‍ً-ٟـ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !LEGAL_WORDS.has(w));
  const key = words.join('');
  return key.length >= 3 ? key : null;
}

type BoxWithSource = LocatedBox & { source: string };

/** One box per field: the user's wins, then one found on the page, then the template's. */
function finalBoxes(boxes: BoxWithSource[]): BoxWithSource[] {
  const rank = (source: string) => (source === 'USER' ? 0 : source === 'MODEL' ? 1 : 2);
  const byField = new Map<string, BoxWithSource>();
  for (const box of boxes) {
    const kept = byField.get(box.field);
    if (!kept || rank(box.source) < rank(kept.source)) byField.set(box.field, box);
  }
  return [...byField.values()];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The layout an invoice's final boxes show, or null without any. `pageAspects`: height ÷ width of each page. */
export function layoutFromBoxes(boxes: BoxWithSource[], pageAspects: number[]): TemplateLayout | null {
  const kept = finalBoxes(boxes);
  const fields: Record<string, TemplateBox> = {};
  for (const { field, page, x, y, width, height } of kept) {
    if (isPickableField(field)) fields[field] = { page, x, y, width, height };
  }
  const lines = kept.filter((b) => isItemField(b.field));
  let items: TemplateItems | null = null;
  if (lines.length) {
    // The page most lines are on; the table is what they cover there.
    const counts = new Map<number, number>();
    for (const l of lines) counts.set(l.page, (counts.get(l.page) ?? 0) + 1);
    const page = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const onPage = lines.filter((l) => l.page === page);
    const x = Math.min(...onPage.map((l) => l.x));
    const y = Math.min(...onPage.map((l) => l.y));
    const right = Math.max(...onPage.map((l) => l.x + l.width));
    const bottom = Math.max(...onPage.map((l) => l.y + l.height));
    // Row pitch: from the tops of consecutive lines when there are several, else the line's own height.
    const tops = onPage.map((l) => l.y).sort((a, b) => a - b);
    const steps = tops.slice(1).map((t, i) => t - tops[i]).filter((d) => d > 0.002);
    const rowHeight = steps.length ? median(steps) : median(onPage.map((l) => l.height));
    items = { page, x, y, width: right - x, height: bottom - y, rowHeight };
  }
  if (!Object.keys(fields).length && !items) return null;
  const used = Math.max(items?.page ?? 0, ...Object.values(fields).map((b) => b.page));
  return { pageAspects: pageAspects.slice(0, used + 1), fields, items };
}

/** Whether a document's pages fit the template: every page it uses is there, with about the same shape. */
export function fitsPages(layout: Pick<TemplateLayout, 'pageAspects'>, pageAspects: number[]): boolean {
  return layout.pageAspects.every((aspect, i) => pageAspects[i] !== undefined && Math.abs(pageAspects[i] - aspect) / aspect <= ASPECT_TOLERANCE);
}

/**
 * The template's boxes for the values this invoice has: each field where the
 * template has it, line item i as row i of the items table (rows may go past
 * the template's last one: this invoice can have more lines). Fields in
 * `skip` (already placed from the words) are left out.
 */
export function placeFromTemplate(layout: TemplateLayout, targets: { fields: string[]; items: number }, skip: Set<string> = new Set()): LocatedBox[] {
  const placed: LocatedBox[] = [];
  for (const field of targets.fields) {
    const box = layout.fields[field];
    if (box && !skip.has(field)) placed.push({ field, ...box });
  }
  const table = layout.items;
  if (table && table.rowHeight > 0) {
    for (let i = 0; i < targets.items; i++) {
      const y = table.y + i * table.rowHeight;
      if (y + table.rowHeight > 1) break;
      if (!skip.has(itemField(i))) placed.push({ field: itemField(i), page: table.page, x: table.x, y, width: table.width, height: table.rowHeight });
    }
  }
  return placed;
}

/**
 * The best template for an invoice among candidates (found by tax ID or name):
 * the tax ID beats the name, the organization's own beats a shared one, then
 * the most trusted (sent often, rarely corrected), then the newest.
 */
export function bestTemplate<T extends StoredTemplate>(candidates: T[], organizationId: string, keys: { taxId: string | null; key: string | null }): T | null {
  const score = (t: T) =>
    [
      keys.taxId && t.vendorTaxId === keys.taxId ? 1 : 0,
      keys.key && t.vendorKey === keys.key ? 1 : 0,
      t.organizationId === organizationId ? 1 : 0,
      t.timesSent - 2 * t.timesCorrected,
      t.updatedAt.getTime()
    ] as const;
  const better = (a: T, b: T) => {
    const [sa, sb] = [score(a), score(b)];
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i];
    return false;
  };
  return candidates.reduce<T | null>((best, t) => (!best || better(t, best) ? t : best), null);
}
