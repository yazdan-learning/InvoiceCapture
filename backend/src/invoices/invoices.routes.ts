import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { authService } from '../auth/auth.routes';
import { requireRole } from '../auth/auth.middleware';
import { createInvoicesController } from './invoices.controller';
import { createInvoicesService } from './invoices.service';
import { N8nInvoiceExtractor } from './adapters/n8n-extractor';
import { LocalDiskFileStorage } from './adapters/local-disk-storage';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import {
  approveSchema,
  exportInvoicesQuerySchema,
  invoiceIdParamsSchema,
  listInvoicesQuerySchema,
  rejectSchema,
  updateInvoiceSchema
} from './invoices.schema';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Unsupported file type'));
      return;
    }
    cb(null, true);
  }
});

// Composition root for this feature: pick concrete adapters here. Swapping n8n
// for another extractor, or local disk for S3, means changing only these two lines.
const invoicesService = createInvoicesService({
  extractor: new N8nInvoiceExtractor({ baseUrl: env.n8nBaseUrl, extractPath: env.n8nExtractPath }),
  fileStorage: new LocalDiskFileStorage(env.uploadsDir),
  approverResolver: authService
});
const invoicesController = createInvoicesController(invoicesService);

export const invoicesRouter = Router();

invoicesRouter.post('/', upload.single('file'), asyncHandler(invoicesController.upload));

// Must come before "/:id" or "export" gets parsed as an invoice id.
invoicesRouter.get(
  '/export',
  validate(exportInvoicesQuerySchema, 'query'),
  asyncHandler(invoicesController.exportCsv)
);

invoicesRouter.get('/', validate(listInvoicesQuerySchema, 'query'), asyncHandler(invoicesController.list));

// Must come before "/:id" — "approvals" would otherwise be parsed as an invoice id.
invoicesRouter.get(
  '/approvals/queue',
  requireRole('APPROVER', 'ADMIN'),
  asyncHandler(invoicesController.approvalQueue)
);

invoicesRouter.get(
  '/:id',
  validate(invoiceIdParamsSchema, 'params'),
  asyncHandler(invoicesController.getById)
);

invoicesRouter.get(
  '/:id/file',
  validate(invoiceIdParamsSchema, 'params'),
  asyncHandler(invoicesController.getFile)
);

invoicesRouter.patch(
  '/:id',
  validate(invoiceIdParamsSchema, 'params'),
  validate(updateInvoiceSchema, 'body'),
  asyncHandler(invoicesController.update)
);

invoicesRouter.post(
  '/:id/submit',
  validate(invoiceIdParamsSchema, 'params'),
  asyncHandler(invoicesController.submit)
);

invoicesRouter.post(
  '/:id/approve',
  requireRole('APPROVER', 'ADMIN'),
  validate(invoiceIdParamsSchema, 'params'),
  validate(approveSchema, 'body'),
  asyncHandler(invoicesController.approve)
);

invoicesRouter.post(
  '/:id/reject',
  requireRole('APPROVER', 'ADMIN'),
  validate(invoiceIdParamsSchema, 'params'),
  validate(rejectSchema, 'body'),
  asyncHandler(invoicesController.reject)
);
