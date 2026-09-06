import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../shared/currencies';
import { SUPPORTED_LANGUAGES } from '../shared/languages';

export const updateOrganizationSettingsSchema = z
  .object({
    mileageRatePerKm: z.number().positive().optional(),
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
    defaultLanguage: z.enum(SUPPORTED_LANGUAGES).optional()
  })
  .refine(
    (data) =>
      data.mileageRatePerKm !== undefined || data.defaultCurrency !== undefined || data.defaultLanguage !== undefined,
    { message: 'Provide at least one setting to update' }
  );

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;
