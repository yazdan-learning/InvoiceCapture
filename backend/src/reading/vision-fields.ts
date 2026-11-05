import { LlmClient } from '../ai/gateway/llm';
import { LOCATE_FIELDS, LocateTarget, locateFieldsPrompt, READ_REGION, readRegionPrompt } from '../ai/prompts/field-boxes';
import { parseJsonObject } from '../ai/replies';
import { retryStep } from '../ai/retry';
import { FieldKind } from './fields';
import { cropRegion, jpegDataUrl, markRegion, PageImage, Region } from './page-images';

export type LocatedBox = Region & { field: string; page: number };

/**
 * One box per field and line item that the vision model found on the pages.
 * Its answer is untrusted: boxes for unknown fields or pages, or outside the
 * page, are dropped; the first box per field wins.
 */
export async function locateFields(
  vision: LlmClient,
  pages: PageImage[],
  fields: LocateTarget[],
  items: LocateTarget[]
): Promise<LocatedBox[]> {
  if (!pages.length || (!fields.length && !items.length)) return [];
  const prompt = locateFieldsPrompt(fields, items, pages.length);
  const answer = await retryStep(async () =>
    parseJsonObject(await vision.complete({ ...LOCATE_FIELDS, prompt, image: pages.map((p) => jpegDataUrl(p.buffer)) }))
  );
  return toBoxes(answer, new Set([...fields, ...items].map((t) => t.field)), pages.length);
}

export function toBoxes(answer: Record<string, unknown>, known: Set<string>, pageCount: number): LocatedBox[] {
  const list = Array.isArray(answer.boxes) ? answer.boxes : [];
  const found = new Map<string, LocatedBox>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { field, page = 0, box_2d: box } = item as Record<string, unknown>;
    if (typeof field !== 'string' || !known.has(field) || found.has(field)) continue;
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page >= pageCount) continue;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    // Gemini's box_2d order: [ymin, xmin, ymax, xmax] in 0-1000.
    const [ymin, xmin, ymax, xmax] = (box as number[]).map((v) => Math.min(1000, Math.max(0, v)) / 1000);
    if (xmax - xmin < 0.002 || ymax - ymin < 0.002) continue;
    found.set(field, { field, page, x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin });
  }
  return [...found.values()];
}

/**
 * What the vision model reads in one region of a page, as text; null when it
 * found nothing. It sees the whole page with the region framed, and the region enlarged.
 */
export async function readRegionValue(
  vision: LlmClient,
  page: PageImage,
  region: Region,
  kind: FieldKind,
  label: string,
  context: { today: string; handwriting?: string }
): Promise<string | null> {
  const prompt = readRegionPrompt(kind, label, context.today, context.handwriting);
  const image = [jpegDataUrl(await markRegion(page, region)), jpegDataUrl(await cropRegion(page, region))];
  const answer = await retryStep(async () => parseJsonObject(await vision.complete({ ...READ_REGION, prompt, image })));
  const value = answer.value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
