-- Tank.tankNumber — dealer-assigned physical tank number, unique per pump,
-- so the Nozzle Master picker can disambiguate two tanks of the same
-- product (see prisma/schema.prisma's comment on Tank.tankNumber). Existing
-- tanks are backfilled with a per-pump sequential number in id order (same
-- backfill-then-NOT-NULL pattern as 20260730102924_add_bill_number).

-- AlterTable: add as nullable first so existing rows can be backfilled below.
ALTER TABLE "Tank" ADD COLUMN "tankNumber" TEXT;

-- Backfill existing tanks, per pump, in a stable (id) order.
WITH ordered AS (
  SELECT "id", "pumpId", row_number() OVER (PARTITION BY "pumpId" ORDER BY "id") AS seq
  FROM "Tank"
)
UPDATE "Tank" t
SET "tankNumber" = o.seq::text
FROM ordered o
WHERE t."id" = o."id";

-- Every existing row now has a value — enforce NOT NULL.
ALTER TABLE "Tank" ALTER COLUMN "tankNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Tank_pumpId_tankNumber_key" ON "Tank"("pumpId", "tankNumber");

-- currentStockLitres is now optional at creation (defaults to 0) — see
-- CreateTankDto.
ALTER TABLE "Tank" ALTER COLUMN "currentStockLitres" SET DEFAULT 0;
