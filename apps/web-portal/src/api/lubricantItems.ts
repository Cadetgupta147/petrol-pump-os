import { apiFetch } from './client';
import type { CreateLubricantItemRequest, LubricantItem, UpdateLubricantItemRequest } from './types';

// POST /lubricant-items — Owner/Accountant/Manager only server-side. 400s if
// the linked Item isn't category LUBRICANT (LubricantItemsService.create()).
export function createLubricantItem(dto: CreateLubricantItemRequest): Promise<LubricantItem> {
  return apiFetch<LubricantItem>('/lubricant-items', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// GET /lubricant-items — includes the linked Item (name/category/unit).
export function getLubricantItems(): Promise<LubricantItem[]> {
  return apiFetch<LubricantItem[]>('/lubricant-items');
}

// PATCH /lubricant-items/:id
export function updateLubricantItem(
  id: string,
  dto: UpdateLubricantItemRequest,
): Promise<LubricantItem> {
  return apiFetch<LubricantItem>(`/lubricant-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
