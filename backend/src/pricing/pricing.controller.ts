import { Request, Response } from 'express';
import { PricingService } from './pricing.service';

export function createPricingController(pricingService: PricingService) {
  return {
    async listSeries(req: Request, res: Response) {
      res.json(await pricingService.listSeries(req.actor.organizationId, req.actor));
    },

    async listMaterials(req: Request, res: Response) {
      res.json(await pricingService.listMaterials(req.actor.organizationId, req.actor));
    },

    async createMaterial(req: Request, res: Response) {
      res.status(201).json(await pricingService.createMaterial(req.actor.organizationId, req.actor, req.body));
    },

    async loadSampleMaterials(req: Request, res: Response) {
      res.json(await pricingService.loadSampleMaterials(req.actor.organizationId, req.actor));
    },

    async updateMaterial(req: Request, res: Response) {
      res.json(await pricingService.updateMaterial(req.actor.organizationId, req.actor, req.params.id, req.body));
    },

    async deleteMaterial(req: Request, res: Response) {
      await pricingService.deleteMaterial(req.actor.organizationId, req.actor, req.params.id);
      res.status(204).end();
    },

    async rematch(req: Request, res: Response) {
      res.json(await pricingService.rematch(req.actor.organizationId, req.actor, req.params.id));
    },

    async confirmMatch(req: Request, res: Response) {
      res.json(await pricingService.confirmMatch(req.actor.organizationId, req.actor, req.params.id, req.body.seriesId));
    },

    async runPricing(req: Request, res: Response) {
      res.json(await pricingService.runPricing(req.actor.organizationId, req.actor));
    },

    async approveProposal(req: Request, res: Response) {
      res.json(await pricingService.approveProposal(req.actor.organizationId, req.actor, req.params.id));
    },

    async rejectProposal(req: Request, res: Response) {
      res.json(await pricingService.rejectProposal(req.actor.organizationId, req.actor, req.params.id));
    }
  };
}
