import { Router } from 'express';
import { env } from '../config/env';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import { createAuthController } from './auth.controller';
import { createAuthService } from './auth.service';
import { requireAuth, requireRole } from './auth.middleware';
import { createUserSchema, loginSchema } from './auth.schema';

// Composition root for the auth module. Exported so other feature modules
// (invoices) can depend on the one method they need (getManagerId) without
// reaching into this module's internals.
export const authService = createAuthService({ jwtSecret: env.jwtSecret });
const authController = createAuthController(authService);

export const authRouter = Router();

authRouter.post('/login', validate(loginSchema, 'body'), asyncHandler(authController.login));

authRouter.get('/me', requireAuth, asyncHandler(authController.me));

authRouter.get('/users', requireAuth, asyncHandler(authController.listUsers));

authRouter.post(
  '/users',
  requireAuth,
  requireRole('ADMIN'),
  validate(createUserSchema, 'body'),
  asyncHandler(authController.createUser)
);
