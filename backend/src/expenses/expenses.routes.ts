import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { authService } from '../auth/auth.routes';
import { requireRole } from '../auth/auth.middleware';
import { createExpensesController } from './expenses.controller';
import { createExpensesService } from './expenses.service';
import { N8nInvoiceExtractor } from './adapters/n8n-extractor';
import { LocalDiskFileStorage } from './adapters/local-disk-storage';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import {
  approveSchema,
  exportExpensesQuerySchema,
  expenseIdParamsSchema,
  listExpensesQuerySchema,
  rejectSchema,
  updateExpenseSchema
} from './expenses.schema';

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
const expensesService = createExpensesService({
  extractor: new N8nInvoiceExtractor({ baseUrl: env.n8nBaseUrl, extractPath: env.n8nExtractPath }),
  fileStorage: new LocalDiskFileStorage(env.uploadsDir),
  approverResolver: authService
});
const expensesController = createExpensesController(expensesService);

export const expensesRouter = Router();

expensesRouter.post('/', upload.single('file'), asyncHandler(expensesController.upload));

// Must come before "/:id" or "export" gets parsed as an expense id.
expensesRouter.get(
  '/export',
  validate(exportExpensesQuerySchema, 'query'),
  asyncHandler(expensesController.exportCsv)
);

expensesRouter.get('/', validate(listExpensesQuerySchema, 'query'), asyncHandler(expensesController.list));

// Must come before "/:id" — "approvals" would otherwise be parsed as an expense id.
expensesRouter.get(
  '/approvals/queue',
  requireRole('APPROVER', 'ADMIN'),
  asyncHandler(expensesController.approvalQueue)
);

expensesRouter.get(
  '/:id',
  validate(expenseIdParamsSchema, 'params'),
  asyncHandler(expensesController.getById)
);

expensesRouter.get(
  '/:id/file',
  validate(expenseIdParamsSchema, 'params'),
  asyncHandler(expensesController.getFile)
);

expensesRouter.patch(
  '/:id',
  validate(expenseIdParamsSchema, 'params'),
  validate(updateExpenseSchema, 'body'),
  asyncHandler(expensesController.update)
);

expensesRouter.post(
  '/:id/submit',
  validate(expenseIdParamsSchema, 'params'),
  asyncHandler(expensesController.submit)
);

expensesRouter.post(
  '/:id/approve',
  requireRole('APPROVER', 'ADMIN'),
  validate(expenseIdParamsSchema, 'params'),
  validate(approveSchema, 'body'),
  asyncHandler(expensesController.approve)
);

expensesRouter.post(
  '/:id/reject',
  requireRole('APPROVER', 'ADMIN'),
  validate(expenseIdParamsSchema, 'params'),
  validate(rejectSchema, 'body'),
  asyncHandler(expensesController.reject)
);
