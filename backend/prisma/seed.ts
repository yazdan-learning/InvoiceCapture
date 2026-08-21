import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'password123'; // local dev only — never used outside seeded accounts

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Default Organization'
    }
  });

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@invoice-ocr.local' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@invoice-ocr.local',
      name: 'Default Admin',
      passwordHash,
      role: 'ADMIN'
    }
  });

  // Reports to admin, so admin is the approver whenever this user submits an
  // invoice — exercises the approval flow out of the box in local dev.
  await prisma.user.upsert({
    where: { email: 'employee@invoice-ocr.local' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'employee@invoice-ocr.local',
      name: 'Default Employee',
      passwordHash,
      role: 'EMPLOYEE',
      managerId: admin.id
    }
  });

  const defaultCategories = ['Office Supplies', 'Travel', 'Utilities', 'Software', 'Other'];
  for (const name of defaultCategories) {
    await prisma.category.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name }
    });
  }

  console.log('Seed complete.');
  console.log(`Dev accounts (password: "${DEV_PASSWORD}"):`);
  console.log('  admin@invoice-ocr.local    (ADMIN, no manager)');
  console.log('  employee@invoice-ocr.local (EMPLOYEE, reports to admin)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
