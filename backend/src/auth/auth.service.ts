import { Role } from '@prisma/client';
import { BadRequestError, ForbiddenError, NotFoundError } from '../shared/errors';
import { authRepository } from './auth.repository';
import { hashPassword, verifyPassword } from './password';
import { signToken } from './token';
import { CreateUserInput, LoginInput, UpdateUserInput } from './auth.schema';

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

      if (!user.active) throw new ForbiddenError('This account has been deactivated');

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

    async updateUser(organizationId: string, targetUserId: string, input: UpdateUserInput) {
      const target = await authRepository.findById(targetUserId);
      if (!target || target.organizationId !== organizationId) throw new NotFoundError('User not found');

      if (input.email && input.email !== target.email) {
        const existing = await authRepository.findByEmail(input.email);
        if (existing) throw new BadRequestError('A user with this email already exists');
      }

      if (input.managerId) {
        if (input.managerId === targetUserId) throw new BadRequestError('A user cannot be their own manager');
        const manager = await authRepository.findById(input.managerId);
        if (!manager || manager.organizationId !== organizationId) {
          throw new BadRequestError('Manager not found in this organization');
        }
      }

      const updated = await authRepository.update(targetUserId, {
        email: input.email,
        name: input.name,
        role: input.role as Role | undefined,
        managerId: input.managerId
      });

      return { id: updated.id, name: updated.name, email: updated.email, role: updated.role, managerId: updated.managerId };
    },

    // Soft delete — see the `active` field's doc comment on the User model
    // for why. Guards against the two ways this could quietly break things:
    // locking the acting admin out of their own account, or stranding a
    // group of reports whose approver can no longer log in to decide on
    // their submissions.
    async deactivateUser(organizationId: string, targetUserId: string, actorUserId: string) {
      if (targetUserId === actorUserId) throw new BadRequestError('You cannot deactivate your own account');

      const target = await authRepository.findById(targetUserId);
      if (!target || target.organizationId !== organizationId) throw new NotFoundError('User not found');

      const activeReports = await authRepository.countActiveReports(targetUserId);
      if (activeReports > 0) {
        throw new BadRequestError(
          'This user is still the manager/approver for other active users — reassign them first'
        );
      }

      await authRepository.deactivate(targetUserId);
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
