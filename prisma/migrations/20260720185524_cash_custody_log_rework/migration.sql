/*
  Warnings:

  - You are about to drop the column `amountHeld` on the `CashCustodyLog` table. All the data in the column will be lost.
  - You are about to drop the column `handedOverAt` on the `CashCustodyLog` table. All the data in the column will be lost.
  - You are about to drop the column `reconciled` on the `CashCustodyLog` table. All the data in the column will be lost.
  - You are about to drop the column `staffId` on the `CashCustodyLog` table. All the data in the column will be lost.
  - Added the required column `broughtBackToday` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `date` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `depositedToBank` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `handledById` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `keptInLocker` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `newOutstanding` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `previousDayOutstanding` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `takenHome` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalCashCollected` to the `CashCustodyLog` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "CashCustodyLog" DROP CONSTRAINT "CashCustodyLog_staffId_fkey";

-- AlterTable
ALTER TABLE "CashCustodyLog" DROP COLUMN "amountHeld",
DROP COLUMN "handedOverAt",
DROP COLUMN "reconciled",
DROP COLUMN "staffId",
ADD COLUMN     "broughtBackToday" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "depositedToBank" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "handledById" TEXT NOT NULL,
ADD COLUMN     "keptInLocker" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "newOutstanding" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "previousDayOutstanding" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "takenHome" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "totalCashCollected" DOUBLE PRECISION NOT NULL;

-- AddForeignKey
ALTER TABLE "CashCustodyLog" ADD CONSTRAINT "CashCustodyLog_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
