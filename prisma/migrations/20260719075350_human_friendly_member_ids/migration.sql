-- Section 6.1/6.7 — human-friendly member IDs.
--
-- 1. New MemberIdCounter singleton (monotonic sequence behind qrMemberId).
-- 2. Backfill every existing customer's qrMemberId from its old raw cuid to
--    the new format  <PUMP_CODE>-CUST-<seq, zero-padded to 5>-<Luhn check
--    digit over the padded seq> , e.g. PUMP001-CUST-00003-5.
--    Sequence numbers are assigned in customer-creation order (createdAt,
--    id as tiebreak) starting at 1. The pump code is fixed to 'PUMP001'
--    here (the single-pump deployment default; new IDs read it from the
--    PUMP_CODE env var, same default).
-- 3. Seed the counter at count(existing customers) so the next allocation
--    continues the sequence.
--
-- Note (Prisma didn't emit a DROP DEFAULT): the old @default(cuid()) was a
-- Prisma-client-side default, not a DB default, so removing it is purely an
-- application-code change — every create path now goes through
-- allocateQrMemberId() (apps/backend/src/customers/member-id.ts).
--
-- The inline Luhn expression below handles the 5-digit padded case, which
-- covers any realistic backfill (< 100,000 pre-existing customers — there
-- are single digits of them today). App-side generation handles longer
-- sequences generically.

-- CreateTable
CREATE TABLE "MemberIdCounter" (
    "id" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,

    CONSTRAINT "MemberIdCounter_pkey" PRIMARY KEY ("id")
);

-- Backfill existing customers to the new member ID format.
-- Luhn over payload d1..d5 (d5 rightmost; the check digit will sit to its
-- right): double d1, d3, d5 (odd positions counted from the right), subtract
-- 9 when a doubled digit exceeds 9, sum, check = (10 - sum mod 10) mod 10.
WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS seq
  FROM "Customer"
),
padded AS (
  SELECT "id", lpad(seq::text, 5, '0') AS pad FROM ordered
),
summed AS (
  SELECT
    "id",
    pad,
    (CASE WHEN substr(pad, 1, 1)::int * 2 > 9 THEN substr(pad, 1, 1)::int * 2 - 9 ELSE substr(pad, 1, 1)::int * 2 END)
      + substr(pad, 2, 1)::int
      + (CASE WHEN substr(pad, 3, 1)::int * 2 > 9 THEN substr(pad, 3, 1)::int * 2 - 9 ELSE substr(pad, 3, 1)::int * 2 END)
      + substr(pad, 4, 1)::int
      + (CASE WHEN substr(pad, 5, 1)::int * 2 > 9 THEN substr(pad, 5, 1)::int * 2 - 9 ELSE substr(pad, 5, 1)::int * 2 END)
      AS luhn_sum
  FROM padded
)
UPDATE "Customer" c
SET "qrMemberId" = 'PUMP001-CUST-' || s.pad || '-' || ((10 - (s.luhn_sum % 10)) % 10)::text
FROM summed s
WHERE c."id" = s."id";

-- Seed the counter so the next allocated sequence continues after the
-- backfilled ones (0 on a fresh database).
INSERT INTO "MemberIdCounter" ("id", "lastSeq")
SELECT 'singleton', count(*)::int FROM "Customer";
