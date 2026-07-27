-- CreateTable
CREATE TABLE "DensityRangeConfig" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "minDensity" DOUBLE PRECISION NOT NULL,
    "maxDensity" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DensityRangeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DensityRangeConfig_pumpId_productType_key" ON "DensityRangeConfig"("pumpId", "productType");

-- AddForeignKey
ALTER TABLE "DensityRangeConfig" ADD CONSTRAINT "DensityRangeConfig_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
