-- AlterEnum
-- No REVIEWED rows existed at migration time. "Submit for approval" does the
-- review-confirm + submit in one action, so REVIEWED never resolved to a real
-- user-facing state.
BEGIN;
CREATE TYPE "InvoiceStatus_new" AS ENUM ('PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED', 'SUBMITTED', 'APPROVED', 'REJECTED');
ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING ("status"::text::"InvoiceStatus_new");
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "InvoiceStatus_old";
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;
