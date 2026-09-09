import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { authService } from '../auth/auth.routes';
import { requireRole } from '../auth/auth.middleware';
import { createExpensesController } from './expenses.controller';
import { createExpensesService } from './expenses.service';
import { N8nInvoiceExtractor } from './adapters/n8n-extractor';
import { LocalDiskFileStorage } from './adapters/local-disk-storage';
import { S3FileStorage } from './adapters/s3-file-storage';
import { GoogleDirectionsCalculator } from './adapters/google-directions';
import { UnconfiguredDistanceCalculator } from './adapters/unconfigured-distance-calculator';
import { FrankfurterCurrencyConverter } from './adapters/frankfurter-currency-converter';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import { FileStorage } from './ports';
import {
  approveSchema,
  createMileageSchema,
  exportExpensesQuerySchema,
  expenseIdParamsSchema,
  listExpensesQuerySchema,
  mileageDistancePreviewSchema,
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
// for another extractor, or local disk for S3, means changing only these lines
// (or, for storage, just the FILE_STORAGE_PROVIDER env var).
const fileStorage: FileStorage =
  env.fileStorageProvider === 's3' ? new S3FileStorage(env.s3) : new LocalDiskFileStorage(env.uploadsDir);

const expensesService = createExpensesService({
  extractor: new N8nInvoiceExtractor({ baseUrl: env.n8nBaseUrl, extractPath: env.n8nExtractPath }),
  fileStorage,
  approverResolver: authService,
  distanceCalculator: env.googleDirectionsApiKey
    ? new GoogleDirectionsCalculator(env.googleDirectionsApiKey)
    : new UnconfiguredDistanceCalculator(),
  currencyConverter: new FrankfurterCurrencyConverter()
});
const expensesController = createExpensesController(expensesService);

export const expensesRouter = Router();

expensesRouter.post('/', upload.single('file'), asyncHandler(expensesController.upload));

// Must come before "/:id" or "mileage"/"currencies"/"language" get parsed as an expense id.
expensesRouter.get('/mileage/rate', asyncHandler(expensesController.getMileageRate));
expensesRouter.get('/currencies', asyncHandler(expensesController.getSupportedCurrencies));
expensesRouter.get('/language', asyncHandler(expensesController.getSupportedLanguages));

expensesRouter.post(
  '/mileage/distance',
  validate(mileageDistancePreviewSchema, 'body'),
  asyncHandler(expensesController.previewMileageDistance)
);

expensesRouter.post(
  '/mileage',
  validate(createMileageSchema, 'body'),
  asyncHandler(expensesController.createMileage)
);

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

expensesRouter.delete(
  '/:id',
  validate(expenseIdParamsSchema, 'params'),
  asyncHandler(expensesController.delete)
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
