-- Rename migration (data-preserving), not a drop/recreate: Prisma's default
-- diff for a field rename is DROP + ADD, which would discard any existing
-- values in the column. CashCustodyLog is a real, potentially populated
-- table (unlike the empty stub table replaced in the prior migration), so
-- this uses ALTER TABLE ... RENAME COLUMN instead.
ALTER TABLE "CashCustodyLog" RENAME COLUMN "previousDayOutstanding" TO "cumulativeOutstandingBeforeToday";
