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

// The organization's country profile, for every signed-in user (mounted
// separately in app.ts, without the ADMIN check): it decides the calendar and
// whether the upload page offers "handwritten".
export const countryRouter = Router();

countryRouter.get('/', asyncHandler(organizationController.getCountry));

// The enabled modules, for every signed-in user (mounted like countryRouter):
// expenses, purchase invoices, or both.
export const modulesRouter = Router();

modulesRouter.get('/', asyncHandler(organizationController.getModules));
