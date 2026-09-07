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
