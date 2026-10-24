-- CreateEnum
CREATE TYPE "AppModule" AS ENUM ('EXPENSES', 'PURCHASE_INVOICES');

-- AlterEnum
ALTER TYPE "ExpenseStatus" ADD VALUE 'SENT';

-- AlterEnum
ALTER TYPE "ExpenseType" ADD VALUE 'PURCHASE_INVOICE';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "accountingError" TEXT,
ADD COLUMN     "accountingRef" TEXT,
ADD COLUMN     "sentToAccountingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "accountingConnector" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "modules" "AppModule"[] DEFAULT ARRAY['EXPENSES']::"AppModule"[];
