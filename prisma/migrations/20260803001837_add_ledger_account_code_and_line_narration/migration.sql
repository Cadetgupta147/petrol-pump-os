-- CreateTable
CREATE TABLE "LedgerAccountCodeCounter" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LedgerAccountCodeCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccountCodeCounter_pumpId_key" ON "LedgerAccountCodeCounter"("pumpId");

-- AddForeignKey
ALTER TABLE "LedgerAccountCodeCounter" ADD CONSTRAINT "LedgerAccountCodeCounter_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add code as nullable first so existing rows can be backfilled
ALTER TABLE "LedgerAccount" ADD COLUMN "code" TEXT;

-- Backfill existing rows with sequential per-pump codes (order of creation),
-- zero-padded to 4 digits, e.g. "0001" — same format allocateLedgerAccountCode()
-- produces for every new ledger going forward.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "pumpId" ORDER BY "createdAt", "id") AS rn
  FROM "LedgerAccount"
)
UPDATE "LedgerAccount" la
SET "code" = LPAD(numbered.rn::text, 4, '0')
FROM numbered
WHERE la."id" = numbered."id";

-- Seed each pump's counter to the number of ledgers just backfilled, so the
-- next allocateLedgerAccountCode() call continues right after them instead
-- of colliding with a backfilled code.
INSERT INTO "LedgerAccountCodeCounter" ("id", "pumpId", "lastSeq")
SELECT substr(md5(random()::text || clock_timestamp()::text), 1, 24), "pumpId", COUNT(*)::int
FROM "LedgerAccount"
GROUP BY "pumpId";

-- Now that every row has a code, enforce NOT NULL + per-pump uniqueness.
ALTER TABLE "LedgerAccount" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "LedgerAccount_pumpId_code_key" ON "LedgerAccount"("pumpId", "code");

-- AlterTable: per-line narration on VoucherLine (nullable, no backfill needed)
ALTER TABLE "VoucherLine" ADD COLUMN "narration" TEXT;
