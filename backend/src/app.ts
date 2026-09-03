import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import multer from 'multer';
import { env } from './config/env';
import { authRouter } from './auth/auth.routes';
import { requireAuth } from './auth/auth.middleware';
import { expensesRouter } from './expenses/expenses.routes';
import { categoriesRouter } from './categories/categories.routes';
import { AppError } from './shared/errors';

export const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// /api/auth/login is public; every other route in that router applies
// requireAuth (and requireRole where needed) itself.
app.use('/api/auth', authRouter);
app.use('/api/expenses', requireAuth, expensesRouter);
app.use('/api/categories', requireAuth, categoriesRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError || (err instanceof Error && err.message === 'Unsupported file type')) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);
