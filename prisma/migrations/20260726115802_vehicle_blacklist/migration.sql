-- CreateEnum
CREATE TYPE "BlacklistScope" AS ENUM ('VEHICLE', 'COMPANY');

-- CreateEnum
CREATE TYPE "BlacklistStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "companyName" TEXT;

-- CreateTable
CREATE TABLE "VehicleBlacklist" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "scope" "BlacklistScope" NOT NULL,
    "vehicleNumber" TEXT,
    "companyName" TEXT,
    "customerId" TEXT,
    "reason" TEXT NOT NULL,
    "outstandingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "BlacklistStatus" NOT NULL DEFAULT 'ACTIVE',
    "referencePhotoUrl" TEXT,
    "blacklistedById" TEXT NOT NULL,
    "blacklistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "VehicleBlacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleBlacklist_pumpId_vehicleNumber_idx" ON "VehicleBlacklist"("pumpId", "vehicleNumber");

-- CreateIndex
CREATE INDEX "VehicleBlacklist_pumpId_companyName_idx" ON "VehicleBlacklist"("pumpId", "companyName");

-- CreateIndex
CREATE INDEX "VehicleBlacklist_pumpId_status_idx" ON "VehicleBlacklist"("pumpId", "status");

-- AddForeignKey
ALTER TABLE "VehicleBlacklist" ADD CONSTRAINT "VehicleBlacklist_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBlacklist" ADD CONSTRAINT "VehicleBlacklist_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBlacklist" ADD CONSTRAINT "VehicleBlacklist_blacklistedById_fkey" FOREIGN KEY ("blacklistedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBlacklist" ADD CONSTRAINT "VehicleBlacklist_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
