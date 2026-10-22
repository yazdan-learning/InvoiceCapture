import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  // 'direct' (default: OCR + LLM run in this process) or 'n8n' (the old
  // workflow, kept as a fallback for one release — the N8N_* vars only matter then).
  invoiceExtractor: (process.env.INVOICE_EXTRACTOR === 'n8n' ? 'n8n' : 'direct') as 'direct' | 'n8n',
  n8nBaseUrl: required('N8N_BASE_URL', 'http://localhost:5678'),
  n8nExtractPath: required('N8N_EXTRACT_PATH', '/webhook/invoice-ocr-mistral'),
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90_000),
  llm: {
    // Any OpenAI-compatible chat-completions API: Mistral (default), Groq,
    // OpenAI, OpenRouter, Ollama (http://localhost:11434/v1), LiteLLM, ...
    // Without LLM_API_KEY the Mistral key is used, so one key runs everything.
    baseUrl: process.env.LLM_BASE_URL || 'https://api.mistral.ai/v1',
    apiKey: process.env.LLM_API_KEY || process.env.MISTRAL_API_KEY || '',
    models: {
      fast: process.env.LLM_MODEL_FAST || 'mistral-medium-latest',
      smart: process.env.LLM_MODEL_SMART || 'mistral-medium-latest'
    }
  },
  // A separate vision model for handwritten invoices (Mistral can't read Persian
  // handwriting). Any OpenAI-compatible API; Gemini by default. Without
  // VISION_API_KEY handwriting goes to the main LLM above.
  vision: {
    baseUrl: process.env.VISION_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: process.env.VISION_API_KEY || '',
    model: process.env.VISION_MODEL || 'gemini-3.5-flash',
    reasoningEffort: process.env.VISION_REASONING_EFFORT || 'none',
    timeoutMs: Number(process.env.VISION_TIMEOUT_MS ?? 45_000)
  },
  ocr: {
    baseUrl: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
    apiKey: process.env.MISTRAL_API_KEY || '',
    model: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest'
  },
  uploadsDir: required('UPLOADS_DIR', './uploads'),
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:5173'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  // Optional on purpose: map-assisted mileage distance is a feature, not a
  // boot requirement — manual distance entry works with no key at all.
  googleDirectionsApiKey: process.env.GOOGLE_DIRECTIONS_API_KEY || null,
  // 'local' (default, writes to UPLOADS_DIR) or 's3' (any S3-compatible
  // bucket — R2, real AWS S3, a self-hosted MinIO). The s3.* fields below are
  // validated by S3FileStorage itself, not here, so 'local' deployments never
  // need to set them.
  fileStorageProvider: (process.env.FILE_STORAGE_PROVIDER === 's3' ? 's3' : 'local') as 'local' | 's3',
  s3: {
    // Leave unset for real AWS S3. Set to an R2/MinIO/etc. endpoint to use that instead.
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'auto',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
  }
};
