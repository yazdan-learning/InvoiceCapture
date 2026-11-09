-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "templateMatch" TEXT;

-- AlterTable
ALTER TABLE "InvoiceTemplate" ADD COLUMN     "firstPageAspect" DOUBLE PRECISION,
ADD COLUMN     "look" JSONB,
ADD COLUMN     "samples" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "words" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "InvoiceTemplate_firstPageAspect_idx" ON "InvoiceTemplate"("firstPageAspect");

