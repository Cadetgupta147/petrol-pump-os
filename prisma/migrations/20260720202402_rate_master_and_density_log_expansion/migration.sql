-- AlterTable
ALTER TABLE "DensityLog" DROP COLUMN "reading",
ADD COLUMN     "densityValue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "dipReadingId" TEXT,
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ppmValue" DOUBLE PRECISION,
ADD COLUMN     "purchaseEntryId" TEXT,
ADD COLUMN     "recordedById" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RateHistory_productType_effectiveFrom_key" ON "RateHistory"("productType", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "DensityLog" ADD CONSTRAINT "DensityLog_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DensityLog" ADD CONSTRAINT "DensityLog_purchaseEntryId_fkey" FOREIGN KEY ("purchaseEntryId") REFERENCES "PurchaseEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DensityLog" ADD CONSTRAINT "DensityLog_dipReadingId_fkey" FOREIGN KEY ("dipReadingId") REFERENCES "DipReading"("id") ON DELETE SET NULL ON UPDATE CASCADE;
