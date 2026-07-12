-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ACCOUNTANT', 'MANAGER', 'DSM', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'CARD', 'UPI', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "EntryChannel" AS ENUM ('WEB', 'DSM_APP');

-- CreateEnum
CREATE TYPE "EarningBasis" AS ENUM ('RUPEE', 'LITRE');

-- CreateEnum
CREATE TYPE "RedemptionType" AS ENUM ('CASH', 'GIFT', 'BOTH');

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "pinHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicleNumber" TEXT,
    "qrMemberId" TEXT NOT NULL,
    "loyaltyRateOverride" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "vehicleNumber" TEXT,
    "customerName" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL,
    "productType" TEXT NOT NULL,
    "rateApplied" DOUBLE PRECISION NOT NULL,
    "enteredById" TEXT NOT NULL,
    "entryChannel" "EntryChannel" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loyaltyPointsEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loyaltyBasisUsed" "EarningBasis",

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPaymentLine" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillPaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "nozzleId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "openingReading" DOUBLE PRECISION NOT NULL,
    "closingReading" DOUBLE PRECISION,
    "shiftStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftEnd" TIMESTAMP(3),

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tank" (
    "id" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "capacityLitres" DOUBLE PRECISION NOT NULL,
    "currentStockLitres" DOUBLE PRECISION NOT NULL,
    "lastDipReading" DOUBLE PRECISION,
    "lastDipAt" TIMESTAMP(3),

    CONSTRAINT "Tank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DensityLog" (
    "id" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "reading" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DensityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSalesSummary" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "dsmId" TEXT NOT NULL,
    "nozzleId" TEXT NOT NULL,
    "walkInLitres" DOUBLE PRECISION NOT NULL,
    "walkInCashCollected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "walkInUpiCollected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "walkInCardCollected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedValue" DOUBLE PRECISION NOT NULL,
    "variance" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftSalesSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpiWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "matchedShiftId" TEXT,
    "matchedNozzleId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpiWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseEntry" (
    "id" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "quantityLitres" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "invoiceImageUrl" TEXT,
    "ocrExtracted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LubricantItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stockQty" INTEGER NOT NULL,
    "reorderAt" INTEGER NOT NULL,

    CONSTRAINT "LubricantItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateHistory" (
    "id" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyConfig" (
    "id" TEXT NOT NULL,
    "earningBasis" "EarningBasis" NOT NULL,
    "defaultRate" DOUBLE PRECISION NOT NULL,
    "redemptionTypeAllowed" "RedemptionType" NOT NULL,
    "customerCanChooseRedemption" BOOLEAN NOT NULL DEFAULT false,
    "defaultRedemptionMode" "RedemptionType",
    "cashRedemptionRatio" DOUBLE PRECISION NOT NULL,
    "minRedeemablePoints" INTEGER NOT NULL,

    CONSTRAINT "LoyaltyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "billId" TEXT,
    "pointsDelta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCatalogItem" (
    "id" TEXT NOT NULL,
    "giftName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "pointsRequired" INTEGER NOT NULL,
    "stockQuantity" INTEGER,
    "activeFlag" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GiftCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "giftItemId" TEXT,
    "redemptionType" "RedemptionType" NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "cashValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCustodyLog" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "amountHeld" DOUBLE PRECISION NOT NULL,
    "handedOverAt" TIMESTAMP(3),
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCustodyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" "PaymentType" NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyExportLog" (
    "id" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "format" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "TallyExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_phone_key" ON "Staff"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_qrMemberId_key" ON "Customer"("qrMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "UpiWebhookEvent_providerEventId_key" ON "UpiWebhookEvent"("providerEventId");

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPaymentLine" ADD CONSTRAINT "BillPaymentLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DensityLog" ADD CONSTRAINT "DensityLog_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionTransaction" ADD CONSTRAINT "RedemptionTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionTransaction" ADD CONSTRAINT "RedemptionTransaction_giftItemId_fkey" FOREIGN KEY ("giftItemId") REFERENCES "GiftCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCustodyLog" ADD CONSTRAINT "CashCustodyLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
