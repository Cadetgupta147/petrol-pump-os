-- CreateEnum
CREATE TYPE "LedgerGroup" AS ENUM ('CASH_IN_HAND', 'BANK', 'SALES', 'PURCHASE', 'SUNDRY_DEBTOR', 'SUNDRY_CREDITOR', 'DIRECT_EXPENSE', 'INDIRECT_EXPENSE', 'CAPITAL_ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "DrCr" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'SALES');

-- CreateEnum
CREATE TYPE "VoucherSource" AS ENUM ('MANUAL', 'BILL', 'EXPENSE', 'CASH_CUSTODY', 'SHIFT_SALES');

-- CreateEnum
CREATE TYPE "SystemLedgerKey" AS ENUM ('CASH', 'SALES', 'CARD_CLEARING', 'UPI_CLEARING', 'BANK_DEFAULT', 'UNLINKED_CREDIT_SALES', 'UNLINKED_CREDIT_EXPENSE');

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "LedgerGroup" NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openingBalanceType" "DrCr" NOT NULL DEFAULT 'DEBIT',
    "isSystemManaged" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" "SystemLedgerKey",
    "linkedCustomerId" TEXT,
    "linkedStaffId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherNumberCounter" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VoucherNumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "voucherType" "VoucherType" NOT NULL,
    "narration" TEXT,
    "source" "VoucherSource" NOT NULL DEFAULT 'MANUAL',
    "sourceKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "drCr" "DrCr" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_linkedCustomerId_key" ON "LedgerAccount"("linkedCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_linkedStaffId_key" ON "LedgerAccount"("linkedStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_pumpId_name_key" ON "LedgerAccount"("pumpId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_pumpId_systemKey_key" ON "LedgerAccount"("pumpId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherNumberCounter_pumpId_key" ON "VoucherNumberCounter"("pumpId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_pumpId_voucherNumber_key" ON "Voucher"("pumpId", "voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_pumpId_sourceKey_key" ON "Voucher"("pumpId", "sourceKey");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_linkedCustomerId_fkey" FOREIGN KEY ("linkedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_linkedStaffId_fkey" FOREIGN KEY ("linkedStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherNumberCounter" ADD CONSTRAINT "VoucherNumberCounter_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
