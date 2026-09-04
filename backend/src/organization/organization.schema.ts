import { z } from 'zod';

export const updateOrganizationSettingsSchema = z.object({
  mileageRatePerKm: z.number().positive()
});

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;
