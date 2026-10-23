-- Country profile per organization (see backend/src/countries/registry.ts).
ALTER TABLE "Organization" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'INTL',
ALTER COLUMN "mileageRatePerKm" SET DATA TYPE DECIMAL(14,3);

-- Rial amounts run into the billions and an IRR rate needs 12 decimals: widen money and rate columns.
ALTER TABLE "Expense" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "taxAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "originalSubtotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "originalTaxAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "originalTotalAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "exchangeRate" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "ExpenseLineItem" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "totalPrice" SET DATA TYPE DECIMAL(18,2);
