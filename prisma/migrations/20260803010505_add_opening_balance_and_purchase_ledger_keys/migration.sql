-- AlterEnum
ALTER TYPE "VoucherSource" ADD VALUE 'OPENING_BALANCE';

-- AlterEnum
ALTER TYPE "SystemLedgerKey" ADD VALUE 'PURCHASE';
ALTER TYPE "SystemLedgerKey" ADD VALUE 'OPENING_BALANCE_ADJUSTMENTS';

-- AlterTable: PurchaseEntry.recordedById, nullable (mirrors paidVia's backward compat)
ALTER TABLE "PurchaseEntry" ADD COLUMN "recordedById" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
