import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RedemptionType } from '@prisma/client';

// POST /customer-portal/redemptions body — the customer-facing counterpart
// to RedemptionsService's CreateRedemptionDto (redemptions/dto/create-redemption.dto.ts).
//
// Deliberately has NO customerId field, unlike the staff-facing DTO: this
// travels over a customer JWT, and the acting customer is always resolved
// server-side from req.user.customerId (CustomerPortalController), never
// from the request body. The global ValidationPipe is configured with
// `whitelist: true, forbidNonWhitelisted: true` (main.ts), so a client that
// smuggles a `customerId` field into the body gets a 400 from the pipe
// before this DTO's fields are even read — there is no field here for such
// a value to land in.
export class CreateCustomerRedemptionDto {
  @IsOptional()
  @IsIn([RedemptionType.CASH, RedemptionType.GIFT])
  redemptionType?: typeof RedemptionType.CASH | typeof RedemptionType.GIFT;

  @IsOptional()
  @IsString()
  giftItemId?: string;

  // How many points to spend on a CASH redemption — see
  // CreateRedemptionDto's identical field for the full rationale (cash value
  // computed server-side, ignored on the GIFT branch).
  @IsOptional()
  @IsInt()
  @Min(1)
  pointsToRedeem?: number;
}
