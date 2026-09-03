-- Rename the core concept from Invoice (document-only) to Expense (broader:
-- receipts today, mileage/per-diem/general later). Data-preserving renames,
-- not a drop/recreate.

-- Rename tables
ALTER TABLE "Invoice" RENAME TO "Expense";
ALTER TABLE "InvoiceLineItem" RENAME TO "ExpenseLineItem";

-- Rename the status enum type
ALTER TYPE "InvoiceStatus" RENAME TO "ExpenseStatus";

-- Rename the FK columns that pointed at "Invoice"
ALTER TABLE "Approval" RENAME COLUMN "invoiceId" TO "expenseId";
ALTER TABLE "ExpenseLineItem" RENAME COLUMN "invoiceId" TO "expenseId";

-- New expense-type discriminator, defaulted so existing rows become RECEIPT
CREATE TYPE "ExpenseType" AS ENUM ('RECEIPT', 'MILEAGE', 'PER_DIEM', 'GENERAL');
ALTER TABLE "Expense" ADD COLUMN "expenseType" "ExpenseType" NOT NULL DEFAULT 'RECEIPT';

-- Document fields are only meaningful for RECEIPT-type expenses
ALTER TABLE "Expense" ALTER COLUMN "filePath" DROP NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "mimeType" DROP NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "fileSizeB" DROP NOT NULL;
