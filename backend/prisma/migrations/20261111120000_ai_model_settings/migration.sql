-- CreateTable
CREATE TABLE "AiModelSetting" (
    "useCase" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelSetting_pkey" PRIMARY KEY ("useCase")
);
