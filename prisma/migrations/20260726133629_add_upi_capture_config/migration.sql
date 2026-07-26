-- CreateEnum
CREATE TYPE "UpiMerchantProvider" AS ENUM ('PHONEPE', 'PAYTM');

-- CreateTable
CREATE TABLE "UpiCaptureConfig" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "autoCaptureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "UpiMerchantProvider",
    "phonePeWebhookUsername" TEXT,
    "phonePeWebhookPassword" TEXT,
    "paytmMerchantKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpiCaptureConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpiCaptureConfig_pumpId_key" ON "UpiCaptureConfig"("pumpId");

-- AddForeignKey
ALTER TABLE "UpiCaptureConfig" ADD CONSTRAINT "UpiCaptureConfig_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
