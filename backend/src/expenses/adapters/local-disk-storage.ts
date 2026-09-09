import path from 'path';
import fs from 'fs/promises';
import { FileStorage, UploadedFile } from '../ports';

// Stand-in for v1. Swapping to S3 later means writing a new class here
// (returning an S3 key instead of a relative path) and changing one line
// in the composition root — nothing else in the app touches storage directly.
export class LocalDiskFileStorage implements FileStorage {
  constructor(private readonly uploadsDir: string) {}

  async save({
    organizationId,
    expenseId,
    file
  }: {
    organizationId: string;
    expenseId: string;
    file: UploadedFile;
  }): Promise<string> {
    const orgDir = path.join(this.uploadsDir, organizationId);
    await fs.mkdir(orgDir, { recursive: true });
    const ext = path.extname(file.originalname);
    const relativePath = path.join(organizationId, `${expenseId}${ext}`);
    await fs.writeFile(path.join(this.uploadsDir, relativePath), file.buffer);
    return relativePath;
  }

  async read(storedPath: string): Promise<Buffer> {
    return fs.readFile(path.join(this.uploadsDir, storedPath));
  }

  async delete(storedPath: string): Promise<void> {
    await fs.rm(path.join(this.uploadsDir, storedPath), { force: true });
  }
}
