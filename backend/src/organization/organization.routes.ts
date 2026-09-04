import { Router } from 'express';
import { createOrganizationController } from './organization.controller';
import { createOrganizationService } from './organization.service';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import { updateOrganizationSettingsSchema } from './organization.schema';

const organizationService = createOrganizationService();
const organizationController = createOrganizationController(organizationService);

// Every route here is ADMIN-only — auth + role are applied once at the
// mount point in app.ts, not per-route.
export const organizationRouter = Router();

organizationRouter.get('/settings', asyncHandler(organizationController.getSettings));
organizationRouter.patch(
  '/settings',
  validate(updateOrganizationSettingsSchema, 'body'),
  asyncHandler(organizationController.updateSettings)
);
