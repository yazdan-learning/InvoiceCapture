-- AlterEnum
ALTER TYPE "FieldBoxSource" ADD VALUE 'TEMPLATE';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "shareTemplates" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "vendorTaxId" TEXT,
    "vendorKey" TEXT,
    "vendorName" TEXT,
    "pageAspects" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "items" JSONB,
    "timesSent" INTEGER NOT NULL DEFAULT 0,
    "timesCorrected" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceTemplate_vendorTaxId_idx" ON "InvoiceTemplate"("vendorTaxId");

-- CreateIndex
CREATE INDEX "InvoiceTemplate_vendorKey_idx" ON "InvoiceTemplate"("vendorKey");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InvoiceTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

