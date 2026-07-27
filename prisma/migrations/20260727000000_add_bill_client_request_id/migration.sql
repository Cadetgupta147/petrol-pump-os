-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Bill_pumpId_clientRequestId_key" ON "Bill"("pumpId", "clientRequestId");
