-- AlterTable
ALTER TABLE "InvoiceTemplate" ADD COLUMN     "cheapFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cheapReads" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "learnedFrom" JSONB NOT NULL DEFAULT '[]';

