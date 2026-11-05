// Locates the fields of stored invoices on their page images, the way the
// review page does for the template-guided reader, and draws the boxes on
// copies of the pages, for checking how well the vision model finds them.
// Saves nothing to the database.
// Usage: npx tsx scripts/try-boxes.ts --out=<folder> <expenseId>...  (keys from .env)
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { env } from '../src/config/env';
import { OpenAiCompatibleLlm } from '../src/ai/gateway/openai-compatible';
import { LocalDiskFileStorage } from '../src/expenses/adapters/local-disk-storage';
import { S3FileStorage } from '../src/expenses/adapters/s3-file-storage';
import { documentPages } from '../src/reading/page-images';
import { locateTargets, ReadableExpense } from '../src/reading/reading.service';
import { locateFields } from '../src/reading/vision-fields';

const out = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? 'boxes-out';
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const prisma = new PrismaClient();
const storage = env.fileStorageProvider === 's3' ? new S3FileStorage(env.s3) : new LocalDiskFileStorage(env.uploadsDir);
const vision = env.vision.apiKey
  ? new OpenAiCompatibleLlm({ ...env.vision, models: { fast: env.vision.model, smart: env.vision.model } })
  : new OpenAiCompatibleLlm({ ...env.llm, timeoutMs: env.aiTimeoutMs });

(async () => {
  mkdirSync(out, { recursive: true });
  for (const id of ids) {
    const expense = await prisma.expense.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!expense?.filePath || !expense.mimeType) {
      console.log(`${id}: no document`);
      continue;
    }
    const pages = await documentPages(await storage.read(expense.filePath), expense.mimeType);
    if (!pages.length) {
      console.log(`${id}: no page images (a PDF made from text)`);
      continue;
    }
    const { fields, items } = locateTargets(expense as unknown as ReadableExpense);
    const started = Date.now();
    const boxes = await locateFields(vision, pages, fields, items);
    console.log(`\n=== ${id}: ${pages.length} page(s), ${boxes.length}/${fields.length + items.length} found (${Date.now() - started} ms)`);
    for (const t of [...fields, ...items]) console.log(`  ${boxes.some((b) => b.field === t.field) ? 'found  ' : 'missing'} ${t.field}: ${t.value}`);

    for (const [index, page] of pages.entries()) {
      const rects = boxes
        .filter((b) => b.page === index)
        .map((b) => {
          const [x, y, w, h] = [b.x * page.width, b.y * page.height, b.width * page.width, b.height * page.height];
          const color = b.field.startsWith('items.') ? '#64748b' : '#f59e0b';
          return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="3"/><text x="${x}" y="${Math.max(14, y - 4)}" font-size="16" font-family="sans-serif" fill="${color}">${b.field}</text>`;
        })
        .join('');
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}">${rects}</svg>`);
      const file = join(out, `${id}-page${index}.jpg`);
      writeFileSync(file, await sharp(page.buffer).composite([{ input: svg }]).jpeg().toBuffer());
      console.log(`  drawn: ${file}`);
    }
  }
  await prisma.$disconnect();
})();
