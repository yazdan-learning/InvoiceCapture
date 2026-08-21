import { Request, Response } from 'express';
import { InvoiceStatus } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { BadRequestError } from '../shared/errors';

export function createInvoicesController(invoicesService: InvoicesService) {
  return {
    async upload(req: Request, res: Response) {
      if (!req.file) throw new BadRequestError('No file uploaded (expected field name: file)');
      const invoice = await invoicesService.uploadAndExtract(
        req.actor.organizationId,
        req.actor.userId,
        req.file
      );
      res.status(201).json(invoice);
    },

    async list(req: Request, res: Response) {
      const query = req.query as unknown as {
        status?: InvoiceStatus;
        search?: string;
        page: number;
        pageSize: number;
      };
      const result = await invoicesService.list(req.actor.organizationId, query, req.actor);
      res.json(result);
    },

    async getById(req: Request, res: Response) {
      const invoice = await invoicesService.getById(req.actor.organizationId, req.params.id, req.actor);
      res.json(invoice);
    },

    async getFile(req: Request, res: Response) {
      const { buffer, mimeType } = await invoicesService.getFile(
        req.actor.organizationId,
        req.params.id,
        req.actor
      );
      res.setHeader('Content-Type', mimeType);
      res.send(buffer);
    },

    async update(req: Request, res: Response) {
      const invoice = await invoicesService.update(req.actor.organizationId, req.params.id, req.body, req.actor);
      res.json(invoice);
    },

    async exportCsv(req: Request, res: Response) {
      const { status } = req.query as { status?: InvoiceStatus };
      const csv = await invoicesService.exportCsv(req.actor.organizationId, status, req.actor);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
      res.send(csv);
    },

    async submit(req: Request, res: Response) {
      const invoice = await invoicesService.submitForApproval(req.actor.organizationId, req.params.id, req.actor);
      res.json(invoice);
    },

    async approve(req: Request, res: Response) {
      const invoice = await invoicesService.decide(
        req.actor.organizationId,
        req.params.id,
        req.actor.userId,
        'APPROVED',
        req.body?.comment ?? null
      );
      res.json(invoice);
    },

    async reject(req: Request, res: Response) {
      const invoice = await invoicesService.decide(
        req.actor.organizationId,
        req.params.id,
        req.actor.userId,
        'REJECTED',
        req.body?.comment ?? null
      );
      res.json(invoice);
    },

    async approvalQueue(req: Request, res: Response) {
      const invoices = await invoicesService.getApprovalQueue(req.actor.organizationId, req.actor.userId);
      res.json({ invoices });
    }
  };
}
