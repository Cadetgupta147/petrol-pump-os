import { PartialType } from '@nestjs/mapped-types';
import { CreateGiftCatalogItemDto } from './create-gift-catalog-item.dto';

// PATCH /gift-catalog/:id — any subset of giftName, imageUrl, pointsRequired,
// stockQuantity, activeFlag. PartialType makes every inherited field
// optional (including giftName/pointsRequired, required on create), same
// pattern as UpdateCustomerDto extends PartialType(CreateCustomerDto).
//
// Retiring a gift goes through DELETE /gift-catalog/:id (soft-retire, see
// GiftCatalogService.remove), not this PATCH — but nothing stops an Owner
// from also flipping activeFlag back to true here to un-retire one.
export class UpdateGiftCatalogItemDto extends PartialType(
  CreateGiftCatalogItemDto,
) {}
