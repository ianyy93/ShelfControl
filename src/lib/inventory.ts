import type { InventoryEntry } from '../types';

export function filterValidInventoryEntries(entries: InventoryEntry[] = []): InventoryEntry[] {
  return entries.filter((entry) => {
    const quantity = Number(entry.quantity) || 0;

    if (quantity <= 0) {
      return false;
    }

    // For opened `pcs` entries, a missing `amount` simply means the item is still
    // valid but not yet tracking remaining pieces. Do not discard unopened entries
    // or open entries just because `amount` is undefined.
    if (entry.unit === 'pcs' && entry.isOpened && entry.amount !== undefined) {
      return Number(entry.amount) > 0;
    }

    return true;
  });
}
