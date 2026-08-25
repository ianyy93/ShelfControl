import type { GroceryItem } from '../types';

export type RestockPolicy = 'essential' | 'optional' | 'manual';

export function getItemServings(item: Pick<GroceryItem, 'inventoryQuantity' | 'servingsPerUnit'>) {
  const quantity = Number(item.inventoryQuantity) || 0;
  const servingsPerUnit = Number(item.servingsPerUnit) || 1;
  return quantity * servingsPerUnit;
}

export function getRestockTarget(item: Pick<GroceryItem, 'restockTarget'>) {
  return Number(item.restockTarget) || 0;
}

export function isItemBelowRestockTarget(item: GroceryItem) {
  if (item.restockPolicy !== 'essential') return false;
  if ((Number(item.inventoryQuantity) || 0) <= 0) return false;

  const target = getRestockTarget(item);
  if (target <= 0) return false;

  return getItemServings(item) < target;
}
