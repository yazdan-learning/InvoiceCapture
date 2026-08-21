import { Router } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../shared/asyncHandler';

export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { organizationId: req.actor.organizationId },
      orderBy: { name: 'asc' }
    });
    res.json(categories);
  })
);
