-- CreateTable
CREATE TABLE "TaxRateConfig" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "taxRatePercent" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxRateConfig_pumpId_productType_key" ON "TaxRateConfig"("pumpId", "productType");

-- AddForeignKey
ALTER TABLE "TaxRateConfig" ADD CONSTRAINT "TaxRateConfig_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
