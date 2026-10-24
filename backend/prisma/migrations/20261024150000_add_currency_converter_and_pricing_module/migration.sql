-- AlterEnum
ALTER TYPE "AppModule" ADD VALUE 'RAW_MATERIAL_PRICING';

-- AlterTable
ALTER TABLE "Expense" RENAME CONSTRAINT "Invoice_pkey" TO "Expense_pkey";

-- AlterTable
ALTER TABLE "ExpenseLineItem" RENAME CONSTRAINT "InvoiceLineItem_pkey" TO "ExpenseLineItem_pkey";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "currencyConverter" TEXT NOT NULL DEFAULT 'FRANKFURTER',
ADD COLUMN     "materialMatcher" TEXT NOT NULL DEFAULT 'LLM';

-- RenameForeignKey
ALTER TABLE "Approval" RENAME CONSTRAINT "Approval_invoiceId_fkey" TO "Approval_expenseId_fkey";

-- RenameForeignKey
ALTER TABLE "Expense" RENAME CONSTRAINT "Invoice_categoryId_fkey" TO "Expense_categoryId_fkey";

-- RenameForeignKey
ALTER TABLE "Expense" RENAME CONSTRAINT "Invoice_organizationId_fkey" TO "Expense_organizationId_fkey";

-- RenameForeignKey
ALTER TABLE "Expense" RENAME CONSTRAINT "Invoice_uploadedBy_fkey" TO "Expense_uploadedBy_fkey";

-- RenameForeignKey
ALTER TABLE "ExpenseLineItem" RENAME CONSTRAINT "InvoiceLineItem_invoiceId_fkey" TO "ExpenseLineItem_expenseId_fkey";

-- RenameIndex
ALTER INDEX "Approval_invoiceId_idx" RENAME TO "Approval_expenseId_idx";

-- RenameIndex
ALTER INDEX "Invoice_organizationId_status_idx" RENAME TO "Expense_organizationId_status_idx";

-- RenameIndex
ALTER INDEX "Invoice_organizationId_vendorName_invoiceNumber_idx" RENAME TO "Expense_organizationId_vendorName_invoiceNumber_idx";

