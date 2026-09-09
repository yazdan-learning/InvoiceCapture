import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';

export const authRepository = {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  create(data: {
    organizationId: string;
    email: string;
    name: string;
    passwordHash: string;
    role: Role;
    managerId?: string | null;
  }) {
    return prisma.user.create({ data });
  },

  list(organizationId: string) {
    return prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true, role: true, managerId: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });
  },

  getManagerId(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { managerId: true } });
  },

  update(
    id: string,
    data: { email?: string; name?: string; role?: Role; managerId?: string | null }
  ) {
    return prisma.user.update({ where: { id }, data });
  },

  deactivate(id: string) {
    return prisma.user.update({ where: { id }, data: { active: false } });
  },

  // Guards deactivation: an inactive manager would silently strand their
  // reports' approvals with no one able to act on them.
  countActiveReports(userId: string) {
    return prisma.user.count({ where: { managerId: userId, active: true } });
  }
};
