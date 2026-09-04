import { prisma } from '../config/prisma';

export const organizationRepository = {
  async get(organizationId: string) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { mileageRatePerKm: true }
    });
    return { mileageRatePerKm: Number(org.mileageRatePerKm) };
  },

  async updateMileageRate(organizationId: string, mileageRatePerKm: number) {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: { mileageRatePerKm },
      select: { mileageRatePerKm: true }
    });
    return { mileageRatePerKm: Number(org.mileageRatePerKm) };
  }
};
