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
 * Apply a +/- delta to a single entry, amount-first for opened entries with
 * a tracked per-package amount:
 * - opened + tracked amount: delta adjusts the amount; if the amount would
 *   drop to 0 or below, one package is finished instead (quantity - 1 and
 *   the amount is cleared — the next package starts untracked)
 * - otherwise: delta adjusts the whole-package count (quantity)
 * Pure — returns a new entry.
 */
export function applyEntryDelta(entry: InventoryEntry, delta: number): InventoryEntry {
  const tracked = entry.amount !== undefined && entry.amount !== null;
  if (entry.isOpened && tracked) {
    if (delta < 0) {
      const newAmount = (Number(entry.amount) || 0) + delta;
      if (newAmount > 0) {
        return { ...entry, amount: newAmount };
      }
      return {
        ...entry,
        quantity: Math.max(0, (Number(entry.quantity) || 0) - 1),
        amount: undefined,
      };
    }
    return { ...entry, amount: (Number(entry.amount) || 0) + delta };
  }
  return { ...entry, quantity: Math.max(0, (Number(entry.quantity) || 0) + delta) };
}

/**
 * Consume whole packages across entries, finishing opened entries (with
 * tracked per-package amounts) before touching unopened package counts.
 * Only entries matching `scope` are considered. Pure — returns new entries
 * plus any unconsumed remainder.
 */
export function consumePackages(
  entries: InventoryEntry[],
  packages: number,
  scope?: (e: InventoryEntry) => boolean
): { entries: InventoryEntry[]; remaining: number } {
  let remaining = Math.max(0, Math.floor(packages));
  const result = entries.map((e) => ({ ...e }));
  const inScope = scope ?? (() => true);

  // Pass 1: finish opened entries with tracked amounts first.
  for (const e of result) {
    if (remaining <= 0) break;
    if (!inScope(e)) continue;
    const qty = Number(e.quantity) || 0;
    if (qty <= 0) continue;
    if (e.isOpened && e.amount !== undefined && e.amount !== null) {
      const take = Math.min(qty, remaining);
      e.quantity = qty - take;
      e.amount = undefined;
      remaining -= take;
    }
  }
  // Pass 2: whole-package counts, in entry order.
  for (const e of result) {
    if (remaining <= 0) break;
    if (!inScope(e)) continue;
    const qty = Number(e.quantity) || 0;
    if (qty <= 0) continue;
    const take = Math.min(qty, remaining);
    e.quantity = qty - take;
    remaining -= take;
  }
  return { entries: result, remaining };
}

/**
 * Return a new entries array with the total package count reduced by
 * `packages` (whole packages). Walks entries in order, reducing quantity and
 * dropping zeroed entries. Pure — does not mutate the input.
 */
export function consumeFromEntries(entries: InventoryEntry[], packages: number): InventoryEntry[] {
  const { entries: result } = consumePackages(entries, packages);
  return result.filter((e) => (Number(e.quantity) || 0) > 0);
}
