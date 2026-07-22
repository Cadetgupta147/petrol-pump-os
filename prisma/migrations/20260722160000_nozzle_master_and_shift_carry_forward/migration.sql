-- Section 3.3/4 — Nozzle master entity + MeterReading.nozzleId becomes a
-- real foreign key instead of a free-text string.
--
-- This dev database already has a handful of MeterReading rows from before
-- the Nozzle master existed (nozzleId was whatever a DSM typed, e.g. "N1").
-- Rather than leave those orphaned or add the FK as NOT VALID, this
-- migration BACKFILLS one real Nozzle per distinct (pumpId, legacy nozzleId)
-- pair, then repoints every existing MeterReading row at the new Nozzle.id,
-- so the FK added at the end is a normal, fully validated constraint —
-- there is no ongoing reconciliation mechanism this relies on, it's a
-- one-time cutover.
--
-- Backfilled startingReading is the MINIMUM openingReading ever recorded
-- against that legacy nozzleId (a conservative, safe placeholder — a real
-- dealer can correct it via PATCH /nozzles/:id, which is only blocked once
-- an even-earlier shift exists, and by construction none will pre-date this
-- backfilled baseline). Backfilled productType falls back to 'UNKNOWN' only
-- if every historical row for that nozzle happened to have a null
-- productType (pre-Section-7.2 legacy data).

-- CreateTable
CREATE TABLE "Nozzle" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "startingReading" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nozzle_pkey" PRIMARY KEY ("id")
);

-- Backfill: one Nozzle per distinct (pumpId, legacy nozzleId) pair already
-- referenced by an existing MeterReading row. The label is the old
-- free-typed nozzleId string itself, so dealers recognize their own
-- existing nozzles after this migration rather than seeing unfamiliar ids.
INSERT INTO "Nozzle" ("id", "pumpId", "label", "productType", "startingReading", "isActive", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text || mr."pumpId" || mr."nozzleId"),
  mr."pumpId",
  mr."nozzleId",
  COALESCE(MIN(mr."productType"), 'UNKNOWN'),
  MIN(mr."openingReading"),
  true,
  CURRENT_TIMESTAMP
FROM "MeterReading" mr
GROUP BY mr."pumpId", mr."nozzleId";

-- Repoint every existing MeterReading at the newly backfilled Nozzle.id
-- (matching on the old nozzleId-as-label, the only correlation key
-- available at this point) before the FK below is added.
UPDATE "MeterReading" mr
SET "nozzleId" = n."id"
FROM "Nozzle" n
WHERE n."pumpId" = mr."pumpId" AND n."label" = mr."nozzleId";

-- CreateIndex
CREATE UNIQUE INDEX "Nozzle_pumpId_label_key" ON "Nozzle"("pumpId", "label");

-- AddForeignKey
ALTER TABLE "Nozzle" ADD CONSTRAINT "Nozzle_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — every MeterReading row now points at a real Nozzle.id
-- (backfilled above), so this is added as a normal validated constraint.
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_nozzleId_fkey" FOREIGN KEY ("nozzleId") REFERENCES "Nozzle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
