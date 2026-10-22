// Runs the direct extractor on local files and prints what it read — for
// checking prompt/model changes against a folder of sample invoices.
// Usage: npx tsx scripts/try-extract.ts [--handwritten] <file-or-folder>...  (keys from .env)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { env } from '../src/config/env';
import { MistralOcr } from '../src/ai/gateway/mistral-ocr';
import { OpenAiCompatibleLlm } from '../src/ai/gateway/openai-compatible';
import { DirectInvoiceExtractor } from '../src/expenses/adapters/direct-extractor';

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };

const handwritten = process.argv.includes('--handwritten');
const files = process.argv.slice(2).filter((a) => a !== '--handwritten').flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).map((f) => join(p, f)) : [p]));
const extractor = new DirectInvoiceExtractor(
  new MistralOcr({ ...env.ocr, timeoutMs: env.aiTimeoutMs }),
  new OpenAiCompatibleLlm({ ...env.llm, timeoutMs: env.aiTimeoutMs }),
  env.vision.apiKey ? new OpenAiCompatibleLlm({ ...env.vision, models: { fast: env.vision.model, smart: env.vision.model } }) : undefined
);

(async () => {
  for (const path of files) {
    const mimetype = TYPES[extname(path).toLowerCase()];
    if (!mimetype) continue;
    const buffer = readFileSync(path);
    const started = Date.now();
    const result = await extractor.extract({ buffer, originalname: path, mimetype, size: buffer.length }, { handwritten });
    console.log(`\n=== ${path} (${Date.now() - started} ms)`);
    console.log(result.success ? JSON.stringify({ warning: result.error, visionError: (result.raw as { visionError?: string } | null)?.visionError, ...result.data }, null, 2) : `FAILED: ${result.error}`);
  }
})();
