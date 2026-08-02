/*
  Warnings:

  - Added the required column `recordedById` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "VoucherSource" ADD VALUE 'PAYMENT';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "recordedById" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
