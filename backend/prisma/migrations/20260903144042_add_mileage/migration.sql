-- Mileage support: flat org-level reimbursement rate + mileage fields on
-- Expense. Additive only, no data affected.

ALTER TABLE "Organization" ADD COLUMN "mileageRatePerKm" DECIMAL(6,3) NOT NULL DEFAULT 0.30;

ALTER TABLE "Expense" ADD COLUMN "mileageDate" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN "mileageFrom" TEXT;
ALTER TABLE "Expense" ADD COLUMN "mileageTo" TEXT;
ALTER TABLE "Expense" ADD COLUMN "mileageDistanceKm" DECIMAL(8,2);
ALTER TABLE "Expense" ADD COLUMN "mileageRoundTrip" BOOLEAN NOT NULL DEFAULT false;
