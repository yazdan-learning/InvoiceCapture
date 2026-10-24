import { z } from 'zod';
import { ROLES } from './permissions';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(ROLES).default('EMPLOYEE'),
  managerId: z.string().uuid().nullable().optional()
});

export const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    name: z.string().min(1).optional(),
    role: z.enum(ROLES).optional(),
    managerId: z.string().uuid().nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
