import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Section 8 — day-end cash reconciliation entry. This single DTO covers BOTH
// steps described in Section 8.1 (day-end split AND "cash brought back from
// home") in one request, rather than two separate endpoints/entities: a
// day's entry for a given handledBy staff member naturally settles what they
// owed from before (broughtBackToday) at the same time it records what
// they're newly holding (takenHome) — see CashCustodyService.create() for
// the carry-forward math this feeds.
//
// cumulativeOutstandingBeforeToday and newOutstanding are NOT accepted here —
// both are server-resolved/computed (see CashCustodyService), never
// client-supplied, so a caller can't spoof away an outstanding balance.
//
// Finding A1 (docs/production-readiness.md) — handledById is OPTIONAL and
// defaults to the authenticated caller when omitted (see
// resolveAssignableActorId(), used by CashCustodyService.create()). It CAN
// still be set to someone else — an Accountant entering the day-end split
// on behalf of the Owner/Manager who actually took cash home is a real,
// intended flow (Section 8.1) — but only a non-DSM caller may do so; a DSM
// submitting can only record for themselves. This is deliberately different
// from Bill's enteredById/editedById/deletedById, which are always the
// caller with no override — see resolveAssignableActorId()'s header comment
// for the full reasoning.
export class CreateCashCustodyLogDto {
  @IsDateString()
  date!: string;

  @IsNumber()
  @Min(0)
  totalCashCollected!: number;

  @IsNumber()
  @Min(0)
  depositedToBank!: number;

  @IsNumber()
  @Min(0)
  keptInLocker!: number;

  @IsNumber()
  @Min(0)
  takenHome!: number;

  @IsOptional()
  @IsString()
  handledById?: string;

  // How much of a PRIOR outstanding balance this person is settling today.
  // Optional/defaults to 0 — most day-end entries have nothing to bring
  // back (e.g. a person's first-ever entry, or one with no outstanding).
  @IsOptional()
  @IsNumber()
  @Min(0)
  broughtBackToday?: number;
}
