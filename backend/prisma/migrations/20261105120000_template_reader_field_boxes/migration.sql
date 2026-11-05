-- CreateEnum
CREATE TYPE "FieldBoxSource" AS ENUM ('MODEL', 'USER');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "boxesLocatedAt" TIMESTAMP(3),
ADD COLUMN     "initialReading" JSONB;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "invoiceReader" TEXT NOT NULL DEFAULT 'CLASSIC';

-- CreateTable
CREATE TABLE "ExpenseFieldBox" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source" "FieldBoxSource" NOT NULL,
    "page" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseFieldBox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseFieldBox_expenseId_field_source_key" ON "ExpenseFieldBox"("expenseId", "field", "source");

-- AddForeignKey
ALTER TABLE "ExpenseFieldBox" ADD CONSTRAINT "ExpenseFieldBox_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

