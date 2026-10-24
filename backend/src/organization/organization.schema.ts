import { z } from 'zod';
import { COUNTRY_IDS } from '../countries/country-profile';
import { SUPPORTED_LANGUAGES } from '../shared/languages';
import { APP_MODULES } from './modules';
import { ACCOUNTING_CONNECTOR_IDS } from '../accounting/registry';

export const updateOrganizationSettingsSchema = z
  .object({
    mileageRatePerKm: z.number().positive().optional(),
    // Which codes are allowed depends on the country (IRR only for Iran) — checked in the service.
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    defaultLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
    country: z.enum(COUNTRY_IDS).optional(),
    modules: z
      .array(z.enum(APP_MODULES))
      .min(1, 'Enable at least one module')
      .transform((modules) => [...new Set(modules)])
      .optional(),
    accountingConnector: z.enum(ACCOUNTING_CONNECTOR_IDS).optional()
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one setting to update'
  });

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;
