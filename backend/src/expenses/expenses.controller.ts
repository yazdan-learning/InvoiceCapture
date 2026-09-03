import { Request, Response } from 'express';
import { ExpenseStatus } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { BadRequestError } from '../shared/errors';

export function createExpensesController(expensesService: ExpensesService) {
  return {
    async upload(req: Request, res: Response) {
      if (!req.file) throw new BadRequestError('No file uploaded (expected field name: file)');
      const expense = await expensesService.uploadAndExtract(
        req.actor.organizationId,
        req.actor.userId,
        req.file
      );
      res.status(201).json(expense);
    },

    async createMileage(req: Request, res: Response) {
      const expense = await expensesService.createMileageExpense(
        req.actor.organizationId,
        req.actor.userId,
        req.body
      );
      res.status(201).json(expense);
    },

    async getMileageRate(req: Request, res: Response) {
      const result = await expensesService.getMileageRate(req.actor.organizationId);
      res.json(result);
    },

    async previewMileageDistance(req: Request, res: Response) {
      const { from, to } = req.body as { from: string; to: string };
      const result = await expensesService.getDistancePreview(from, to);
      res.json(result);
    },

    async list(req: Request, res: Response) {
      const query = req.query as unknown as {
        status?: ExpenseStatus;
        search?: string;
        page: number;
        pageSize: number;
      };
      const result = await expensesService.list(req.actor.organizationId, query, req.actor);
      res.json(result);
    },

    async getById(req: Request, res: Response) {
      const expense = await expensesService.getById(req.actor.organizationId, req.params.id, req.actor);
      res.json(expense);
    },

    async getFile(req: Request, res: Response) {
      const { buffer, mimeType } = await expensesService.getFile(
        req.actor.organizationId,
        req.params.id,
        req.actor
      );
      res.setHeader('Content-Type', mimeType);
      res.send(buffer);
    },

    async update(req: Request, res: Response) {
      const expense = await expensesService.update(req.actor.organizationId, req.params.id, req.body, req.actor);
      res.json(expense);
    },

    async exportCsv(req: Request, res: Response) {
      const { status } = req.query as { status?: ExpenseStatus };
      const csv = await expensesService.exportCsv(req.actor.organizationId, status, req.actor);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
      res.send(csv);
    },

    async submit(req: Request, res: Response) {
      const expense = await expensesService.submitForApproval(req.actor.organizationId, req.params.id, req.actor);
      res.json(expense);
    },

    async approve(req: Request, res: Response) {
      const expense = await expensesService.decide(
        req.actor.organizationId,
        req.params.id,
        req.actor.userId,
        'APPROVED',
        req.body?.comment ?? null
      );
      res.json(expense);
    },

    async reject(req: Request, res: Response) {
      const expense = await expensesService.decide(
        req.actor.organizationId,
        req.params.id,
        req.actor.userId,
        'REJECTED',
        req.body?.comment ?? null
      );
      res.json(expense);
    },

    async approvalQueue(req: Request, res: Response) {
      const expenses = await expensesService.getApprovalQueue(req.actor.organizationId, req.actor.userId);
      res.json({ expenses });
    }
  };
}
