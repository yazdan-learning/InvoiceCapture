import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../shared/asyncHandler';
import { validate } from '../shared/validate';
import { ReadingService } from './reading.service';

// Field boxes and "pick from photo", under /api/expenses/:id (mounted by
// expenses.routes.ts, which already requires a signed-in user).

const expenseParams = z.object({ id: z.string().uuid() });
const pageParams = expenseParams.extend({ page: z.coerce.number().int().min(0) });

const fraction = z.number().min(0).max(1);
const readRegionSchema = z.object({
  field: z.string().min(1),
  page: z.number().int().min(0),
  region: z
    .object({ x: fraction, y: fraction, width: fraction.positive(), height: fraction.positive() })
    .refine((r) => r.x + r.width <= 1.0001 && r.y + r.height <= 1.0001, { message: 'The region must lie on the page' })
});

export function createReadingRouter(reading: ReadingService): Router {
  const router = Router();

  router.get(
    '/:id/field-boxes',
    validate(expenseParams, 'params'),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await reading.getFieldBoxes(req.actor.organizationId, req.params.id, req.actor));
    })
  );

  router.get(
    '/:id/reading-checks',
    validate(expenseParams, 'params'),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await reading.getReadingChecks(req.actor.organizationId, req.params.id, req.actor));
    })
  );

  router.get(
    '/:id/pages/:page',
    validate(pageParams, 'params'),
    asyncHandler(async (req: Request, res: Response) => {
      const image = await reading.getPageImage(req.actor.organizationId, req.params.id, Number(req.params.page), req.actor);
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(image);
    })
  );

  router.post(
    '/:id/read-region',
    validate(expenseParams, 'params'),
    validate(readRegionSchema, 'body'),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await reading.readRegion(req.actor.organizationId, req.params.id, req.actor, req.body));
    })
  );

  return router;
}
