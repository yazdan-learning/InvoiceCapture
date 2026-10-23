import { z } from 'zod';
import { COUNTRY_IDS } from '../countries/country-profile';
import { SUPPORTED_LANGUAGES } from '../shared/languages';

export const updateOrganizationSettingsSchema = z
  .object({
    mileageRatePerKm: z.number().positive().optional(),
    // Which codes are allowed depends on the country (IRR only for Iran) — checked in the service.
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    defaultLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
    country: z.enum(COUNTRY_IDS).optional()
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one setting to update'
  });

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;
