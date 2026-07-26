import { IsOptional, IsString } from 'class-validator';

// PATCH /vehicle-blacklist/:id/resolve — marks an entry RESOLVED (dues
// cleared / dispute settled). resolvedById/resolvedAt are stamped by the
// service from the authenticated caller, not accepted from the body — same
// "never trust the frontend for who/when" precedent as Bill's
// enteredById/deletedById (BillsController derives them from req.user).
export class ResolveVehicleBlacklistDto {
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
