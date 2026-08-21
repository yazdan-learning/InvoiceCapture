import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';
import { BadRequestError } from './errors';

type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new BadRequestError(result.error.issues.map((i) => i.message).join(', ')));
      return;
    }
    req[source] = result.data;
    next();
  };
}
