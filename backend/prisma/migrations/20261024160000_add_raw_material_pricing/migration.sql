-- CreateEnum
CREATE TYPE "MaterialMatchStatus" AS ENUM ('NEEDS_REVIEW', 'CONFIRMED', 'NO_INDEX');

-- CreateEnum
CREATE TYPE "PriceProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RawMaterial" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "currency" TEXT NOT NULL,
    "currentPrice" DECIMAL(18,2) NOT NULL,
    "currentPriceDate" TIMESTAMP(3) NOT NULL,
    "matchStatus" "MaterialMatchStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "seriesId" TEXT,
    "suggestedSeriesId" TEXT,
    "suggestionConfidence" DECIMAL(5,4),
    "suggestionReason" TEXT,
    "suggestedBy" TEXT,
    "matchError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialPriceProposal" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "previousPrice" DECIMAL(18,2) NOT NULL,
    "previousDate" TIMESTAMP(3) NOT NULL,
    "proposedPrice" DECIMAL(18,2) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "indexFrom" DECIMAL(14,4) NOT NULL,
    "indexTo" DECIMAL(14,4) NOT NULL,
    "indexPeriod" TEXT NOT NULL,
    "fxFrom" DECIMAL(24,12) NOT NULL,
    "fxTo" DECIMAL(24,12) NOT NULL,
    "status" "PriceProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPriceProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterial_organizationId_name_key" ON "RawMaterial"("organizationId", "name");

-- CreateIndex
CREATE INDEX "MaterialPriceProposal_materialId_status_idx" ON "MaterialPriceProposal"("materialId", "status");

-- AddForeignKey
ALTER TABLE "RawMaterial" ADD CONSTRAINT "RawMaterial_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPriceProposal" ADD CONSTRAINT "MaterialPriceProposal_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "RawMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

