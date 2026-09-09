import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import path from 'path';
import { FileStorage, UploadedFile } from '../ports';

export type S3FileStorageConfig = {
  // Leave undefined to talk to real AWS S3. Set to point at any S3-compatible
  // endpoint instead — Cloudflare R2 (`https://<account-id>.r2.cloudflarestorage.com`),
  // a self-hosted MinIO, etc. This one class covers all of them; only the
  // endpoint changes.
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Files stay private in the bucket — there's no public URL anywhere in this
// class on purpose. Access always goes through the app's own authenticated
// /api/expenses/:id/file route (see expenses.service.ts getFile), exactly
// like LocalDiskFileStorage today; only where the bytes physically live
// changes. Receipts are financial documents, not the public-gallery-image
// case a bucket might otherwise default to.
export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3FileStorageConfig) {
    if (!config.bucket) throw new Error('S3_BUCKET env var is required when FILE_STORAGE_PROVIDER=s3');
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY env vars are required when FILE_STORAGE_PROVIDER=s3');
    }
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // R2 rejects the extra checksum header the SDK adds by default; AWS
      // itself works fine either way, so restricting it to only when an
      // operation actually requires one is safe for both.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    });
  }

  async save({
    organizationId,
    expenseId,
    file
  }: {
    organizationId: string;
    expenseId: string;
    file: UploadedFile;
  }): Promise<string> {
    const ext = path.extname(file.originalname);
    const key = `${organizationId}/${expenseId}${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype
      })
    );
    return key;
  }

  async read(storedPath: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: storedPath })
    );
    return streamToBuffer(result.Body);
  }

  async delete(storedPath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: storedPath }));
  }
}
