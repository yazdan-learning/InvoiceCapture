ALTER TABLE "Organization" ADD COLUMN "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR';

ALTER TABLE "Expense" ADD COLUMN "originalCurrency" TEXT;
ALTER TABLE "Expense" ADD COLUMN "originalSubtotal" DECIMAL(12,2);
ALTER TABLE "Expense" ADD COLUMN "originalTaxAmount" DECIMAL(12,2);
ALTER TABLE "Expense" ADD COLUMN "originalTotalAmount" DECIMAL(12,2);
ALTER TABLE "Expense" ADD COLUMN "exchangeRate" DECIMAL(12,6);
ALTER TABLE "Expense" ADD COLUMN "exchangeRateDate" TIMESTAMP(3);
