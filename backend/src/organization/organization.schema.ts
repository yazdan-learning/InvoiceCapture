import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../shared/currencies';

export const updateOrganizationSettingsSchema = z
  .object({
    mileageRatePerKm: z.number().positive().optional(),
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES).optional()
  })
  .refine((data) => data.mileageRatePerKm !== undefined || data.defaultCurrency !== undefined, {
    message: 'Provide at least one setting to update'
  });

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;
