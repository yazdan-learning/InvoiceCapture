import { TallImageOcr } from '@yazdan-learning/ai';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { authService } from '../auth/auth.routes';
import { requireRole } from '../auth/auth.middleware';
import { APPROVER_ROLES } from '../auth/permissions';
import { createExpensesController } from './expenses.controller';
import { createExpensesService } from './expenses.service';
import { N8nInvoiceExtractor } from './adapters/n8n-extractor';
import { DirectInvoiceExtractor } from './adapters/direct-extractor';
import { ReaderSwitchExtractor, TemplateInvoiceExtractor } from '../reading/template-extractor';
import { MistralOcr } from '../ai/gateway/mistral-ocr';
import { OpenAiCompatibleLlm } from '../ai/gateway/openai-compatible';
import { TesseractOcr } from '@yazdan-learning/ai';
import { LocalDiskFileStorage } from './adapters/local-disk-storage';
import { S3FileStorage } from './adapters/s3-file-storage';
import { GoogleDirectionsCalculator } from './adapters/google-directions';
import { UnconfiguredDistanceCalculator } from './adapters/unconfigured-distance-calculator';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import { FileStorage, InvoiceExtractor } from './ports';
import { createReadingService } from '../reading/reading.service';
import { createReadingRouter } from '../reading/reading.routes';
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

function directExtractor(): InvoiceExtractor {
  const ocr = new MistralOcr({ ...env.ocr, timeoutMs: env.aiTimeoutMs });
  const classic = new DirectInvoiceExtractor(
    ocr,
    new OpenAiCompatibleLlm({ ...env.llm, timeoutMs: env.aiTimeoutMs }),
    env.vision.apiKey ? new OpenAiCompatibleLlm({ ...env.vision, models: { fast: env.vision.model, smart: env.vision.model } }) : undefined
  );
  // TEMPLATE organizations: the classic reading plus the shared checks (reading/template-extractor.ts).
  const large = env.llm.largeModel
    ? new OpenAiCompatibleLlm({ ...env.llm, models: { fast: env.llm.largeModel, smart: env.llm.largeModel }, timeoutMs: env.aiTimeoutMs })
    : null;
  // TEMPLATE reads a shop app's long receipt in pieces (OCR shrinks a page that tall); CLASSIC reads it whole as before.
  return new ReaderSwitchExtractor(classic, new TemplateInvoiceExtractor(classic, new TallImageOcr(ocr), large));
}

const extractor: InvoiceExtractor =
  env.invoiceExtractor === 'n8n' ? new N8nInvoiceExtractor({ baseUrl: env.n8nBaseUrl, extractPath: env.n8nExtractPath }) : directExtractor();

const expensesService = createExpensesService({
  extractor,
  fileStorage,
  approverResolver: authService,
  distanceCalculator: env.googleDirectionsApiKey
    ? new GoogleDirectionsCalculator(env.googleDirectionsApiKey)
    : new UnconfiguredDistanceCalculator()
});
const expensesController = createExpensesController(expensesService);

// Field boxes (organizations on the template-guided reader): boxes and "read
// from box" from the Tesseract service's word positions when TESSERACT_URL is
// set (which also draws PDFs made from text as page images); "Read with AI"
// with the vision model, or with the main LLM when no separate vision model is configured.
const wordOcr = env.tesseract.url ? new TesseractOcr({ baseUrl: env.tesseract.url, token: env.tesseract.token, languages: env.tesseract.languages, timeoutMs: env.tesseract.timeoutMs }) : null;
const readingService = createReadingService({
  expenses: expensesService,
  fileStorage,
  words: () => wordOcr,
  renderer: () => wordOcr,
  vision: () =>
    env.vision.apiKey
      ? new OpenAiCompatibleLlm({ ...env.vision, models: { fast: env.vision.model, smart: env.vision.model } })
      : new OpenAiCompatibleLlm({ ...env.llm, timeoutMs: env.aiTimeoutMs })
});

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
  requireRole(...APPROVER_ROLES),
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

// Purchase invoices only; who may send is checked in the service (module + role).
expensesRouter.post(
  '/:id/send',
  validate(expenseIdParamsSchema, 'params'),
  asyncHandler(expensesController.sendToAccounting)
);

expensesRouter.post(
  '/:id/approve',
  requireRole(...APPROVER_ROLES),
  validate(expenseIdParamsSchema, 'params'),
  validate(approveSchema, 'body'),
  asyncHandler(expensesController.approve)
);

expensesRouter.post(
  '/:id/reject',
  requireRole(...APPROVER_ROLES),
  validate(expenseIdParamsSchema, 'params'),
  validate(rejectSchema, 'body'),
  asyncHandler(expensesController.reject)
);

expensesRouter.use(createReadingRouter(readingService));
