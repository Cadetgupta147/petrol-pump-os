-- DropForeignKey
ALTER TABLE "Bill" DROP CONSTRAINT "Bill_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "BillAuditLog" DROP CONSTRAINT "BillAuditLog_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "BillPaymentLine" DROP CONSTRAINT "BillPaymentLine_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "BusinessProfile" DROP CONSTRAINT "BusinessProfile_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "CashCustodyLog" DROP CONSTRAINT "CashCustodyLog_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "CreditConfig" DROP CONSTRAINT "CreditConfig_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "CreditLimitAlert" DROP CONSTRAINT "CreditLimitAlert_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerOtp" DROP CONSTRAINT "CustomerOtp_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "DensityLog" DROP CONSTRAINT "DensityLog_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "DipReading" DROP CONSTRAINT "DipReading_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "GiftCatalogItem" DROP CONSTRAINT "GiftCatalogItem_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "LoyaltyConfig" DROP CONSTRAINT "LoyaltyConfig_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT "LoyaltyTransaction_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "LubricantItem" DROP CONSTRAINT "LubricantItem_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "MemberIdCounter" DROP CONSTRAINT "MemberIdCounter_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "MeterReading" DROP CONSTRAINT "MeterReading_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseEntry" DROP CONSTRAINT "PurchaseEntry_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "RateHistory" DROP CONSTRAINT "RateHistory_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "RedemptionTransaction" DROP CONSTRAINT "RedemptionTransaction_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftSalesSummary" DROP CONSTRAINT "ShiftSalesSummary_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "TallyExportLog" DROP CONSTRAINT "TallyExportLog_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "Tank" DROP CONSTRAINT "Tank_pumpId_fkey";

-- DropForeignKey
ALTER TABLE "UpiWebhookEvent" DROP CONSTRAINT "UpiWebhookEvent_pumpId_fkey";

-- AlterTable
ALTER TABLE "Bill" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "BillAuditLog" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "BillPaymentLine" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "BusinessProfile" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CashCustodyLog" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CreditConfig" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CreditLimitAlert" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CustomerOtp" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "DensityLog" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "DipReading" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GiftCatalogItem" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LoyaltyConfig" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LoyaltyTransaction" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LubricantItem" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "MemberIdCounter" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "MeterReading" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PurchaseEntry" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RateHistory" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RedemptionTransaction" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ShiftSalesSummary" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Staff" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TallyExportLog" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Tank" ALTER COLUMN "pumpId" SET NOT NULL;

-- AlterTable
ALTER TABLE "UpiWebhookEvent" ALTER COLUMN "pumpId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOtp" ADD CONSTRAINT "CustomerOtp_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIdCounter" ADD CONSTRAINT "MemberIdCounter_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAuditLog" ADD CONSTRAINT "BillAuditLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPaymentLine" ADD CONSTRAINT "BillPaymentLine_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditConfig" ADD CONSTRAINT "CreditConfig_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLimitAlert" ADD CONSTRAINT "CreditLimitAlert_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tank" ADD CONSTRAINT "Tank_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DipReading" ADD CONSTRAINT "DipReading_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DensityLog" ADD CONSTRAINT "DensityLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSalesSummary" ADD CONSTRAINT "ShiftSalesSummary_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiWebhookEvent" ADD CONSTRAINT "UpiWebhookEvent_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LubricantItem" ADD CONSTRAINT "LubricantItem_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateHistory" ADD CONSTRAINT "RateHistory_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyConfig" ADD CONSTRAINT "LoyaltyConfig_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCatalogItem" ADD CONSTRAINT "GiftCatalogItem_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionTransaction" ADD CONSTRAINT "RedemptionTransaction_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCustodyLog" ADD CONSTRAINT "CashCustodyLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyExportLog" ADD CONSTRAINT "TallyExportLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

