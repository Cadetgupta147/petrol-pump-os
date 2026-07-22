-- Item Master + Nozzle hardening (rollover, DB-level single-open-shift
-- guarantee) + a bounded correction endpoint's audit columns + optional
-- Bill.nozzleId.
--
-- Backfill strategy for Nozzle.productType -> Nozzle.itemId: this dev
-- database already has 3 Nozzle rows with free-text productType values
-- ("Petrol", "UNKNOWN" x2 from the earlier Nozzle-master migration's own
-- backfill). One Item is created per distinct (pumpId, productType) pair
-- actually referenced by an existing Nozzle, named after that productType
-- string, category FUEL / unit LITRE (a safe default — a dealer can
-- recategorize via PATCH /items/:id afterwards). Every Nozzle is then
-- repointed at the matching Item before productType is dropped, so this is
-- a clean cutover, not a NOT VALID / best-effort constraint.

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('FUEL', 'LUBRICANT', 'OTHER');

-- CreateEnum
CREATE TYPE "ItemUnit" AS ENUM ('LITRE', 'KG', 'PIECE');

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Item_pumpId_name_key" ON "Item"("pumpId", "name");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one Item per distinct (pumpId, productType) pair already
-- referenced by an existing Nozzle.
INSERT INTO "Item" ("id", "pumpId", "name", "category", "unit", "isActive", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text || nz."pumpId" || nz."productType"),
  nz."pumpId",
  nz."productType",
  'FUEL'::"ItemCategory",
  'LITRE'::"ItemUnit",
  true,
  CURRENT_TIMESTAMP
FROM "Nozzle" nz
GROUP BY nz."pumpId", nz."productType";

-- AlterTable: Nozzle gains itemId (nullable during backfill) + rolloverAt.
ALTER TABLE "Nozzle" ADD COLUMN "itemId" TEXT;
ALTER TABLE "Nozzle" ADD COLUMN "rolloverAt" DOUBLE PRECISION;

-- Repoint every existing Nozzle at its backfilled Item.
UPDATE "Nozzle" nz
SET "itemId" = it."id"
FROM "Item" it
WHERE it."pumpId" = nz."pumpId" AND it."name" = nz."productType";

-- Every Nozzle now has an itemId (backfilled above) — safe to require and
-- drop the old free-text column.
ALTER TABLE "Nozzle" ALTER COLUMN "itemId" SET NOT NULL;
ALTER TABLE "Nozzle" DROP COLUMN "productType";

-- AddForeignKey
ALTER TABLE "Nozzle" ADD CONSTRAINT "Nozzle_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: MeterReading gains the DB-level open-shift lock column, the
-- rollover flag, and the correction audit pair.
ALTER TABLE "MeterReading" ADD COLUMN "openLockNozzleId" TEXT;
ALTER TABLE "MeterReading" ADD COLUMN "meterRolledOver" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MeterReading" ADD COLUMN "correctedById" TEXT;
ALTER TABLE "MeterReading" ADD COLUMN "correctedAt" TIMESTAMP(3);

-- Backfill: any currently-open shift (closingReading IS NULL) gets its
-- openLockNozzleId set to its own nozzleId, matching what openShift()/
-- closeShift() maintain going forward. Safe as a unique value per row
-- since a nozzle can only have one open shift at a time by construction
-- (the app-level check this constraint now backs up).
UPDATE "MeterReading" SET "openLockNozzleId" = "nozzleId" WHERE "closingReading" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_openLockNozzleId_key" ON "MeterReading"("openLockNozzleId");

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Bill gains an optional nozzleId — see prisma/schema.prisma's
-- comment on Bill.nozzleId for why this is nullable and not yet populated
-- by most entry points.
ALTER TABLE "Bill" ADD COLUMN "nozzleId" TEXT;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_nozzleId_fkey" FOREIGN KEY ("nozzleId") REFERENCES "Nozzle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
