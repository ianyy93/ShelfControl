import type { GroceryItem, InventoryEntry } from '../types';
import { convertQuantityToUnit, normalizeUnit } from './units';

// Locked semantics (Phase 1+2 cleanup):
// - InventoryEntry.quantity = whole-package count (number >= 0)
// - InventoryEntry.amount   = content per package, in entry.unit (optional)
// - entry.unit              = canonical unit, normalized on every write path
// - item.inventoryQuantity  = derived sum of entry quantities (see getPackageCount)

/**
 * An entry is valid iff it has a positive package count AND its per-package
 * amount is either untracked (undefined/null) or positive. A missing amount
 * simply means the item is not tracking per-package content — it is NOT the
 * same as zero stock.
 */
export function filterValidInventoryEntries(entries: InventoryEntry[] = []): InventoryEntry[] {
  return entries.filter((entry) => {
    const quantity = Number(entry.quantity) || 0;
    if (quantity <= 0) {
      return false;
    }
    if (entry.amount === undefined || entry.amount === null) {
      return true;
    }
    return Number(entry.amount) > 0;
  });
}

/** Sum of package counts across entries. Package counts are unit-agnostic. */
export function sumEntryQuantities(entries: InventoryEntry[] = []): number {
  return entries.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
}

/**
 * The item's package count, derived from its entries.
 * Falls back to the stored inventoryQuantity only for legacy docs that have
 * no inventoryEntries array at all.
 */
export function getPackageCount(item: Pick<GroceryItem, 'inventoryEntries' | 'inventoryQuantity'>): number {
  if (Array.isArray(item.inventoryEntries)) {
    return sumEntryQuantities(item.inventoryEntries);
  }
  return Number(item.inventoryQuantity) || 0;
}

/**
 * Total content across entries that track a per-package amount, expressed in
 * a single unit (the most common normalized unit among those entries).
 * Returns null when no entries track amounts, or when amounts use
 * incompatible units (e.g. pcs vs g) — we refuse to fabricate a total.
 */
export function getTotalContent(item: Pick<GroceryItem, 'inventoryEntries'>): { value: number; unit: string } | null {
  const entries = item.inventoryEntries || [];
  const withAmounts = entries.filter(
    (e) =>
      e.amount !== undefined &&
      e.amount !== null &&
      Number(e.amount) > 0 &&
      (Number(e.quantity) || 0) > 0
  );
  if (withAmounts.length === 0) {
    return null;
  }

  // Target unit: the most common normalized unit among amount-tracking entries.
  const counts = new Map<string, number>();
  for (const e of withAmounts) {
    const u = normalizeUnit(e.unit);
    counts.set(u, (counts.get(u) || 0) + 1);
  }
  let target = '';
  let best = -1;
  for (const [u, c] of counts) {
    if (c > best) {
      best = c;
      target = u;
    }
  }

  let total = 0;
  for (const e of withAmounts) {
    const fromUnit = normalizeUnit(e.unit);
    const perPackage = Number(e.amount) || 0;
    const packages = Number(e.quantity) || 0;
    if (fromUnit === target) {
      total += packages * perPackage;
      continue;
    }
    const converted = convertQuantityToUnit(perPackage, fromUnit, target);
    if (converted === null) {
      return null;
    }
    total += packages * converted;
  }
  return { value: total, unit: target };
}

/**
 * Normalize every entry's unit to the item's canonical unit, converting
 * per-package amounts where possible. Package counts (quantity) are never
 * converted — they are unit-agnostic. Entries whose amount cannot be
 * converted keep their own normalized unit (they stay separate, never merged
 * into a bogus total).
 */
export function coerceEntriesToUnit(entries: InventoryEntry[], targetUnit?: string | null): InventoryEntry[] {
  const canonical = normalizeUnit(targetUnit);
  return (entries || []).map((entry) => {
    const fromUnit = entry.unit ? normalizeUnit(entry.unit) : canonical;
    if (fromUnit === canonical) {
      return { ...entry, unit: canonical };
    }
    const amount = entry.amount;
    if (amount === undefined || amount === null) {
      return { ...entry, unit: fromUnit };
    }
    const converted = convertQuantityToUnit(Number(amount) || 0, fromUnit, canonical);
    if (converted === null) {
      return { ...entry, unit: fromUnit };
    }
    return { ...entry, unit: canonical, amount: converted };
  });
}

/**
 * Return a new entries array with the total package count reduced by
 * `packages` (whole packages). Walks entries in order, reducing quantity and
 * dropping zeroed entries. Pure — does not mutate the input.
 */
export function consumeFromEntries(entries: InventoryEntry[], packages: number): InventoryEntry[] {
  let remaining = Math.max(0, Math.floor(packages));
  if (remaining <= 0) {
    return [...entries];
  }
  const result: InventoryEntry[] = [];
  for (const entry of entries) {
    if (remaining <= 0) {
      result.push(entry);
      continue;
    }
    const qty = Number(entry.quantity) || 0;
    if (qty <= 0) {
      continue; // drop zeroed entries
    }
    if (qty > remaining) {
      result.push({ ...entry, quantity: qty - remaining });
      remaining = 0;
    } else {
      remaining -= qty;
      // entry fully consumed — dropped
    }
  }
  return result;
}
