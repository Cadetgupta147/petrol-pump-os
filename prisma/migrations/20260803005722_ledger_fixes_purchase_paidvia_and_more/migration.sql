-- AlterEnum
ALTER TYPE "VoucherType" ADD VALUE 'PURCHASE';

-- AlterTable: PurchaseEntry.paidVia, nullable (existing rows stay ledger-blind on purpose)
ALTER TABLE "PurchaseEntry" ADD COLUMN "paidVia" "PaymentType";

-- AlterTable: CashCustodyLog.bankLedgerAccountId, nullable (null = existing BANK_DEFAULT fallback)
ALTER TABLE "CashCustodyLog" ADD COLUMN "bankLedgerAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "CashCustodyLog" ADD CONSTRAINT "CashCustodyLog_bankLedgerAccountId_fkey" FOREIGN KEY ("bankLedgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
