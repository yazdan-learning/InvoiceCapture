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
  n8nBaseUrl: required('N8N_BASE_URL', 'http://localhost:5678'),
  n8nExtractPath: required('N8N_EXTRACT_PATH', '/webhook/invoice-ocr-mistral'),
  uploadsDir: required('UPLOADS_DIR', './uploads'),
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:5173'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  // Optional on purpose: map-assisted mileage distance is a feature, not a
  // boot requirement — manual distance entry works with no key at all.
  googleDirectionsApiKey: process.env.GOOGLE_DIRECTIONS_API_KEY || null
};
