import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

// POST /gift-catalog — Section 6.4 Lever 2 (gift catalog CRUD). Owner-only
// (class-level @Roles(Role.OWNER) on GiftCatalogController) — Section 6.4
// frames the whole redemption side as "entirely the dealer's call", same
// restriction pattern as LoyaltyConfigController's PUT.
//
// stockQuantity is optional AND nullable: per Section 6.4's table it's
// "Optional — if tracked, the gift auto-hides or shows 'out of stock' when
// depleted". Omitting it (or explicitly passing null) means untracked
// stock — a gift that never blocks on stock from the software's point of
// view (see GiftCatalogService / RedemptionsService). imageUrl is nullable
// for the same "not every gift has a photo yet" reason.
export class CreateGiftCatalogItemDto {
  @IsString()
  giftName!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsInt()
  @Min(1)
  pointsRequired!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number | null;

  @IsOptional()
  @IsBoolean()
  activeFlag?: boolean;
}
