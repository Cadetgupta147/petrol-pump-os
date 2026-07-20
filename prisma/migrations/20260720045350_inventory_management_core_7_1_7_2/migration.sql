/*
  Warnings:

  - Added the required column `ratePerLitre` to the `PurchaseEntry` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN     "productType" TEXT;

-- AlterTable
ALTER TABLE "PurchaseEntry" ADD COLUMN     "invoiceNo" TEXT,
ADD COLUMN     "ratePerLitre" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "tankerNo" TEXT;

-- AlterTable
ALTER TABLE "Tank" ADD COLUMN     "calibrationChartRef" TEXT;

-- CreateTable
CREATE TABLE "DipReading" (
    "id" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "reading" DOUBLE PRECISION NOT NULL,
    "systemStockAtReading" DOUBLE PRECISION NOT NULL,
    "variance" DOUBLE PRECISION NOT NULL,
    "flagged" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DipReading_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DipReading" ADD CONSTRAINT "DipReading_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DipReading" ADD CONSTRAINT "DipReading_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
