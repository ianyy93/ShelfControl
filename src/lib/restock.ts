import type { GroceryItem } from '../types';

export type RestockPolicy = 'essential' | 'optional' | 'manual';

export const CATEGORY_RESTOCK_TARGETS: Record<string, number> = {
  vegetables: 3,
  fruits: 2,
  soup: 2,
  noodles: 2,
  seasoning: 2,
  Produce: 3,
  'Dairy & Eggs': 2,
  'Meat & Seafood': 2,
  Pantry: 2,
  Frozen: 2,
  Beverages: 2,
  Snacks: 2,
  Household: 1,
  'Dog Supplies': 1,
  Other: 0,
};

export function getAvailableUnopenedStock(item: Pick<GroceryItem, 'inventoryEntries' | 'inventoryQuantity'>) {
  const unopened = (item.inventoryEntries || []).filter(entry => !entry.isOpened).reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
  return unopened > 0 ? unopened : (Number(item.inventoryQuantity) || 0);
}

export function getItemServings(item: Pick<GroceryItem, 'inventoryQuantity' | 'servingsPerUnit'>) {
  const quantity = Number(item.inventoryQuantity) || 0;
  const servingsPerUnit = Number(item.servingsPerUnit) || 1;
  return quantity * servingsPerUnit;
}

export function getCategoryRestockTarget(category?: string | null) {
  if (!category) return 0;
  const normalized = category.trim();
  if (!normalized) return 0;
  return Number(CATEGORY_RESTOCK_TARGETS[normalized] ?? 0) || 0;
}

export function getEffectiveRestockTarget(item: Pick<GroceryItem, 'restockTarget' | 'category'>) {
  if (typeof item.restockTarget === 'number') {
    return Number(item.restockTarget) || 0;
  }
  return getCategoryRestockTarget(item.category);
}

export function isItemBelowRestockTarget(item: GroceryItem) {
  if (item.restockPolicy !== 'essential') return false;

  const target = getEffectiveRestockTarget(item);
  const unopenedStock = getAvailableUnopenedStock(item);
  return unopenedStock <= target;
}
