-- DropIndex
DROP INDEX "RateHistory_productType_effectiveFrom_key";

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "BillAuditLog" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "BillPaymentLine" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "CashCustodyLog" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "CreditConfig" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "CreditLimitAlert" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "CustomerOtp" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "DensityLog" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "DipReading" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "GiftCatalogItem" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "LoyaltyConfig" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "LoyaltyTransaction" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "LubricantItem" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "MemberIdCounter" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseEntry" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "RateHistory" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "RedemptionTransaction" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "ShiftSalesSummary" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "TallyExportLog" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "Tank" ADD COLUMN     "pumpId" TEXT;

-- AlterTable
ALTER TABLE "UpiWebhookEvent" ADD COLUMN     "pumpId" TEXT;

-- CreateTable
CREATE TABLE "Pump" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pumpCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pump_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pump_pumpCode_key" ON "Pump"("pumpCode");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_pumpId_key" ON "BusinessProfile"("pumpId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditConfig_pumpId_key" ON "CreditConfig"("pumpId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyConfig_pumpId_key" ON "LoyaltyConfig"("pumpId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberIdCounter_pumpId_key" ON "MemberIdCounter"("pumpId");

-- CreateIndex
CREATE UNIQUE INDEX "RateHistory_pumpId_productType_effectiveFrom_key" ON "RateHistory"("pumpId", "productType", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "CustomerOtp" ADD CONSTRAINT "CustomerOtp_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIdCounter" ADD CONSTRAINT "MemberIdCounter_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAuditLog" ADD CONSTRAINT "BillAuditLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPaymentLine" ADD CONSTRAINT "BillPaymentLine_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditConfig" ADD CONSTRAINT "CreditConfig_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLimitAlert" ADD CONSTRAINT "CreditLimitAlert_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tank" ADD CONSTRAINT "Tank_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DipReading" ADD CONSTRAINT "DipReading_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DensityLog" ADD CONSTRAINT "DensityLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSalesSummary" ADD CONSTRAINT "ShiftSalesSummary_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiWebhookEvent" ADD CONSTRAINT "UpiWebhookEvent_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LubricantItem" ADD CONSTRAINT "LubricantItem_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateHistory" ADD CONSTRAINT "RateHistory_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyConfig" ADD CONSTRAINT "LoyaltyConfig_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCatalogItem" ADD CONSTRAINT "GiftCatalogItem_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionTransaction" ADD CONSTRAINT "RedemptionTransaction_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCustodyLog" ADD CONSTRAINT "CashCustodyLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyExportLog" ADD CONSTRAINT "TallyExportLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill (docs/multi-tenancy-plan.md Phase 0.1): bootstrap a single
-- "default" Pump and backfill every existing row across all tenant tables to
-- belong to it, so nothing orphans and nothing breaks while pumpId is still
-- nullable. Phase 0.3 flips pumpId to required once the Phase 2 Prisma
-- Client Extension guarantees every create path supplies it going forward.
INSERT INTO "Pump" (id, name, "pumpCode", active, "createdAt", "updatedAt")
VALUES ('default_pump', 'Default Pump', 'PUMP001', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "Bill" SET "pumpId" = 'default_pump';
UPDATE "BillAuditLog" SET "pumpId" = 'default_pump';
UPDATE "BillPaymentLine" SET "pumpId" = 'default_pump';
UPDATE "CreditConfig" SET "pumpId" = 'default_pump';
UPDATE "BusinessProfile" SET "pumpId" = 'default_pump';
UPDATE "CreditLimitAlert" SET "pumpId" = 'default_pump';
UPDATE "MeterReading" SET "pumpId" = 'default_pump';
UPDATE "Tank" SET "pumpId" = 'default_pump';
UPDATE "DipReading" SET "pumpId" = 'default_pump';
UPDATE "DensityLog" SET "pumpId" = 'default_pump';
UPDATE "ShiftSalesSummary" SET "pumpId" = 'default_pump';
UPDATE "UpiWebhookEvent" SET "pumpId" = 'default_pump';
UPDATE "PurchaseEntry" SET "pumpId" = 'default_pump';
UPDATE "LubricantItem" SET "pumpId" = 'default_pump';
UPDATE "RateHistory" SET "pumpId" = 'default_pump';
UPDATE "LoyaltyConfig" SET "pumpId" = 'default_pump';
UPDATE "LoyaltyTransaction" SET "pumpId" = 'default_pump';
UPDATE "GiftCatalogItem" SET "pumpId" = 'default_pump';
UPDATE "RedemptionTransaction" SET "pumpId" = 'default_pump';
UPDATE "CashCustodyLog" SET "pumpId" = 'default_pump';
UPDATE "Payment" SET "pumpId" = 'default_pump';
UPDATE "TallyExportLog" SET "pumpId" = 'default_pump';
UPDATE "CustomerOtp" SET "pumpId" = 'default_pump';
UPDATE "MemberIdCounter" SET "pumpId" = 'default_pump';
