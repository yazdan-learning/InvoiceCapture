import { Request, Response } from 'express';
import { AuthService } from './auth.service';

export function createAuthController(authService: AuthService) {
  return {
    async login(req: Request, res: Response) {
      const result = await authService.login(req.body);
      res.json(result);
    },

    async createUser(req: Request, res: Response) {
      const user = await authService.createUser(req.actor.organizationId, req.body);
      res.status(201).json(user);
    },

    async listUsers(req: Request, res: Response) {
      const users = await authService.listUsers(req.actor.organizationId);
      res.json(users);
    },

    async me(req: Request, res: Response) {
      res.json(req.actor);
    }
  };
}
