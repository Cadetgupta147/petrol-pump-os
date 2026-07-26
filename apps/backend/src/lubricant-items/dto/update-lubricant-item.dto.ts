import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateLubricantItemDto } from './create-lubricant-item.dto';

// PATCH /lubricant-items/:id — any subset of sku/costPrice/salePrice/
// stockQty/reorderAt. itemId is deliberately omitted — the Item Master link
// is set once at creation and never repointed (same identity-is-immutable
// reasoning as Nozzle.itemId).
export class UpdateLubricantItemDto extends PartialType(
  OmitType(CreateLubricantItemDto, ['itemId'] as const),
) {}
