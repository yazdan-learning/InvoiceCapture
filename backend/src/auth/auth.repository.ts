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
      select: { id: true, name: true, email: true, role: true, managerId: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });
  },

  getManagerId(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { managerId: true } });
  }
};
