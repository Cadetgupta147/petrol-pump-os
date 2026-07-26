import { apiFetch } from './client';
import type { CreateItemSaleRequest, ItemSale } from './types';

// POST /item-sales — Owner/Accountant/Manager only server-side. 404s on an
// unknown item or an unconfigured lubricant stock row, 400s on a FUEL-
// category item, 409s on insufficient lubricant stock
// (ItemSalesService.create()).
export function createItemSale(dto: CreateItemSaleRequest): Promise<ItemSale> {
  return apiFetch<ItemSale>('/item-sales', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// GET /item-sales — includes the linked Item (name/category/unit), most
// recent first.
export function getItemSales(): Promise<ItemSale[]> {
  return apiFetch<ItemSale[]>('/item-sales');
}
