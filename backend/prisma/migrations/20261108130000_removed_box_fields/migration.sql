-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "removedBoxFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

