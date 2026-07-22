-- Phase 0.2 (docs/multi-tenancy-plan.md): split Staff/Customer identity from
-- per-pump membership. Unlike the auto-generated `prisma migrate diff` output
-- (which drops the old phone/pinHash/passwordHash/tokenVersion columns in the
-- SAME statement as adding the new ones), this is hand-sequenced so the old
-- column values can be copied into the new Account tables BEFORE they're
-- dropped — a single-pass diff would destroy the data.

-- CreateTable
CREATE TABLE "StaffAccount" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pinHash" TEXT,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add new columns first, nullable, no FK yet.
ALTER TABLE "Staff" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Staff" ADD COLUMN "pumpId" TEXT;

ALTER TABLE "Customer" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "pumpId" TEXT;

-- Data backfill: split existing Staff/Customer rows into Account (identity)
-- + membership (existing table) pairs. Reuses each existing row's own id as
-- the new Account row's id — safe 1:1 mapping, since every Staff/Customer
-- row today already represents exactly one person before this split.
-- Informal customers with no phone get no CustomerAccount (accountId stays
-- NULL), matching how Customer.phone was already nullable for exactly this
-- reason before the split.
INSERT INTO "StaffAccount" (id, phone, "pinHash", "passwordHash", name, active, "createdAt", "updatedAt")
SELECT id, phone, "pinHash", "passwordHash", name, active, "createdAt", "updatedAt" FROM "Staff";

UPDATE "Staff" SET "accountId" = id, "pumpId" = 'default_pump';

INSERT INTO "CustomerAccount" (id, phone, name, "tokenVersion", "createdAt")
SELECT id, phone, name, "tokenVersion", "createdAt" FROM "Customer" WHERE phone IS NOT NULL;

UPDATE "Customer" SET "accountId" = id WHERE phone IS NOT NULL;
UPDATE "Customer" SET "pumpId" = 'default_pump';

-- Now that the data is copied over, drop the old single-tenant columns.
DROP INDEX "Customer_phone_key";
DROP INDEX "Staff_phone_key";

ALTER TABLE "Staff" DROP COLUMN "passwordHash",
DROP COLUMN "phone",
DROP COLUMN "pinHash";

ALTER TABLE "Customer" DROP COLUMN "tokenVersion";

-- CreateIndex
CREATE UNIQUE INDEX "StaffAccount_phone_key" ON "StaffAccount"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_phone_key" ON "CustomerAccount"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_accountId_pumpId_key" ON "Customer"("accountId", "pumpId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_accountId_pumpId_key" ON "Staff"("accountId", "pumpId");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StaffAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE SET NULL ON UPDATE CASCADE;
