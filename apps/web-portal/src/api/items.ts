import { apiFetch } from './client';
import type { CreateItemRequest, Item, UpdateItemRequest } from './types';

// GET /items — Item Master: everything this pump sells. includeInactive is
// only ever passed true by the Item Settings screen (so a disabled item can
// still be found and re-enabled) — every other dropdown (Nozzle setup,
// Tank/Purchase-entry product pickers) omits it and gets active items only.
export function getItems(includeInactive = false): Promise<Item[]> {
  return apiFetch<Item[]>(`/items${includeInactive ? '?includeInactive=true' : ''}`);
}

// POST /items — Settings: register a new item (Petrol, Diesel, Speed,
// Urea/AdBlue, a lubricant SKU, ...). Owner/Accountant/Manager.
export function createItem(dto: CreateItemRequest): Promise<Item> {
  return apiFetch<Item>('/items', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /items/:id — rename, recategorize, or soft-disable (isActive: false).
export function updateItem(id: string, dto: UpdateItemRequest): Promise<Item> {
  return apiFetch<Item>(`/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
