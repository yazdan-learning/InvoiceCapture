import { z } from 'zod';

export const idParamsSchema = z.object({
  id: z.string().uuid()
});

export const createMaterialSchema = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(50).nullable().optional(),
  // The price it has today in the ERP, and the day that price applied.
  price: z.number().positive(),
  priceDate: z.coerce.date()
});

export const updateMaterialSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    unit: z.string().trim().max(50).nullable().optional(),
    price: z.number().positive().optional(),
    priceDate: z.coerce.date().optional()
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: 'Provide at least one field to update' });

export const confirmMatchSchema = z.object({
  // null = no index fits this material; its price is kept by hand.
  seriesId: z.string().min(1).nullable()
});
