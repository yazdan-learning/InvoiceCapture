import { Role } from '@prisma/client';
import { BadRequestError } from '../shared/errors';
import { authRepository } from './auth.repository';
import { hashPassword, verifyPassword } from './password';
import { signToken } from './token';
import { CreateUserInput, LoginInput } from './auth.schema';

type Deps = {
  jwtSecret: string;
};

export function createAuthService({ jwtSecret }: Deps) {
  return {
    async login({ email, password }: LoginInput) {
      const user = await authRepository.findByEmail(email);
      if (!user) throw new BadRequestError('Invalid email or password');

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) throw new BadRequestError('Invalid email or password');

      const token = signToken({ userId: user.id, organizationId: user.organizationId, role: user.role }, jwtSecret);
      return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    },

    async createUser(organizationId: string, input: CreateUserInput) {
      const existing = await authRepository.findByEmail(input.email);
      if (existing) throw new BadRequestError('A user with this email already exists');

      const passwordHash = await hashPassword(input.password);
      const user = await authRepository.create({
        organizationId,
        email: input.email,
        name: input.name,
        passwordHash,
        role: input.role as Role,
        managerId: input.managerId ?? null
      });

      return { id: user.id, name: user.name, email: user.email, role: user.role, managerId: user.managerId };
    },

    listUsers(organizationId: string) {
      return authRepository.list(organizationId);
    },

    // The one method the invoices module needs to route approvals — see
    // invoices/ports.ts ApproverResolver. Everything else about identity stays
    // behind this module's own boundary.
    async getApprover(userId: string) {
      const user = await authRepository.getManagerId(userId);
      if (!user?.managerId) return null;

      const manager = await authRepository.findById(user.managerId);
      if (!manager) return null;

      return { id: manager.id, role: manager.role };
    }
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
