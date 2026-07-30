-- Bill.billNumber — human-friendly, per-pump sequential bill number
-- (<PUMP_CODE>-<seq, zero-padded to 6>, e.g. "PUMP001-000123"), same pattern
-- as Customer.qrMemberId/MemberIdCounter (see
-- 20260719075350_human_friendly_member_ids). New allocations go through
-- allocateBillNumber() (apps/backend/src/bills/bill-number.ts), which reads/
-- increments a BillNumberCounter row inside the same transaction as the Bill
-- create.
--
-- Existing bills are backfilled in per-pump chronological order (timestamp,
-- id as tiebreak), starting at 1. BillNumberCounter is then seeded per-pump
-- at count(existing bills for that pump) — 0 for a pump with none yet — so
-- the next allocation continues the backfilled sequence.
--
-- BillNumberCounter.id: Prisma's @default(cuid()) is a client-side default
-- (not a DB default — see the note in the member-id migration this mirrors),
-- so this raw SQL insert can't call it; 'billctr_' || pumpId is unique and
-- stable instead, which is all this ever needs.

-- CreateTable
CREATE TABLE "BillNumberCounter" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,

    CONSTRAINT "BillNumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillNumberCounter_pumpId_key" ON "BillNumberCounter"("pumpId");

-- AddForeignKey
ALTER TABLE "BillNumberCounter" ADD CONSTRAINT "BillNumberCounter_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add as nullable first so existing rows can be backfilled below.
ALTER TABLE "Bill" ADD COLUMN "billNumber" TEXT;

-- Backfill existing bills, per pump, in creation order.
WITH ordered AS (
  SELECT "id", "pumpId", row_number() OVER (PARTITION BY "pumpId" ORDER BY "timestamp", "id") AS seq
  FROM "Bill"
)
UPDATE "Bill" b
SET "billNumber" = p."pumpCode" || '-' || lpad(o.seq::text, 6, '0')
FROM ordered o
JOIN "Pump" p ON p."id" = o."pumpId"
WHERE b."id" = o."id";

-- Every existing row now has a value — enforce NOT NULL.
ALTER TABLE "Bill" ALTER COLUMN "billNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Bill_pumpId_billNumber_key" ON "Bill"("pumpId", "billNumber");

-- Seed BillNumberCounter for every existing pump (0 if it has no bills yet).
INSERT INTO "BillNumberCounter" ("id", "pumpId", "lastSeq")
SELECT 'billctr_' || p."id", p."id", COALESCE(b.cnt, 0)
FROM "Pump" p
LEFT JOIN (SELECT "pumpId", count(*) AS cnt FROM "Bill" GROUP BY "pumpId") b ON b."pumpId" = p."id";
