import { Request, Response } from 'express';
import { OrganizationService } from './organization.service';

export function createOrganizationController(organizationService: OrganizationService) {
  return {
    async getSettings(req: Request, res: Response) {
      const settings = await organizationService.getSettings(req.actor.organizationId);
      res.json(settings);
    },

    async updateSettings(req: Request, res: Response) {
      const settings = await organizationService.updateSettings(req.actor.organizationId, req.body);
      res.json(settings);
    }
  };
}
