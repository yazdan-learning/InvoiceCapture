import { Router } from 'express';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import { createPricingController } from './pricing.controller';
import { createPricingService } from './pricing.service';
import { confirmMatchSchema, createMaterialSchema, idParamsSchema, updateMaterialSchema } from './pricing.schema';

// Composition root: the sample index source, and the matcher and exchange-rate
// source each organization picked in Settings (resolved per call).
const pricingService = createPricingService();
const pricingController = createPricingController(pricingService);

// Module and role (accountant/admin) are checked in the service.
export const pricingRouter = Router();

pricingRouter.get('/series', asyncHandler(pricingController.listSeries));

pricingRouter.get('/materials', asyncHandler(pricingController.listMaterials));
pricingRouter.post('/materials', validate(createMaterialSchema, 'body'), asyncHandler(pricingController.createMaterial));
// Must come before "/materials/:id" routes so "sample" isn't parsed as an id.
pricingRouter.post('/materials/sample', asyncHandler(pricingController.loadSampleMaterials));
pricingRouter.patch(
  '/materials/:id',
  validate(idParamsSchema, 'params'),
  validate(updateMaterialSchema, 'body'),
  asyncHandler(pricingController.updateMaterial)
);
pricingRouter.delete('/materials/:id', validate(idParamsSchema, 'params'), asyncHandler(pricingController.deleteMaterial));
pricingRouter.post('/materials/:id/rematch', validate(idParamsSchema, 'params'), asyncHandler(pricingController.rematch));
pricingRouter.post(
  '/materials/:id/confirm-match',
  validate(idParamsSchema, 'params'),
  validate(confirmMatchSchema, 'body'),
  asyncHandler(pricingController.confirmMatch)
);

pricingRouter.post('/run', asyncHandler(pricingController.runPricing));
pricingRouter.post('/proposals/:id/approve', validate(idParamsSchema, 'params'), asyncHandler(pricingController.approveProposal));
pricingRouter.post('/proposals/:id/reject', validate(idParamsSchema, 'params'), asyncHandler(pricingController.rejectProposal));
