import { describe, it, expect } from 'vitest';
import {
  filterValidInventoryEntries,
  sumEntryQuantities,
  getPackageCount,
  getTotalContent,
  coerceEntriesToUnit,
  consumeFromEntries,
} from './inventory.ts';
import type { InventoryEntry } from '../types.ts';

const entry = (overrides: Partial<InventoryEntry> = {}): InventoryEntry => ({
  id: 'e1',
  location: '',
  quantity: 1,
  ...overrides,
});

describe('filterValidInventoryEntries', () => {
  it('keeps entries with positive quantity and no amount tracked', () => {
    const entries = [entry({ quantity: 2 })];
    expect(filterValidInventoryEntries(entries)).toHaveLength(1);
  });

  it('keeps entries with positive quantity and positive amount', () => {
    const entries = [entry({ quantity: 2, amount: 500, unit: 'g' })];
    expect(filterValidInventoryEntries(entries)).toHaveLength(1);
  });

  it('drops entries with zero or negative quantity', () => {
    const entries = [entry({ quantity: 0 }), entry({ quantity: -1 })];
    expect(filterValidInventoryEntries(entries)).toHaveLength(0);
  });

  it('drops entries with a zero amount even when unopened (uniform rule)', () => {
    const entries = [entry({ quantity: 2, amount: 0, unit: 'g', isOpened: false })];
    expect(filterValidInventoryEntries(entries)).toHaveLength(0);
  });

  it('drops opened pcs entries whose amount reached zero', () => {
    const entries = [entry({ quantity: 1, amount: 0, unit: 'pcs', isOpened: true })];
    expect(filterValidInventoryEntries(entries)).toHaveLength(0);
  });

  it('keeps opened entries with an untracked amount', () => {
    const entries = [entry({ quantity: 1, unit: 'pcs', isOpened: true })];
    expect(filterValidInventoryEntries(entries)).toHaveLength(1);
  });
});

describe('sumEntryQuantities / getPackageCount', () => {
  it('sums package counts across entries', () => {
    const entries = [entry({ quantity: 2 }), entry({ quantity: 3 }), entry({ quantity: 0 })];
    expect(sumEntryQuantities(entries)).toBe(5);
  });

  it('derives the package count from entries when present', () => {
    const item = { inventoryQuantity: 99, inventoryEntries: [entry({ quantity: 2 }), entry({ quantity: 1 })] };
    expect(getPackageCount(item)).toBe(3);
  });

  it('falls back to inventoryQuantity for legacy docs without an entries array', () => {
    expect(getPackageCount({ inventoryQuantity: 7 } as any)).toBe(7);
    expect(getPackageCount({ inventoryQuantity: 7, inventoryEntries: undefined } as any)).toBe(7);
  });

  it('returns 0 for an empty entries array (no legacy fallback)', () => {
    expect(getPackageCount({ inventoryQuantity: 7, inventoryEntries: [] })).toBe(0);
  });
});

describe('getTotalContent', () => {
  it('returns null when no entries track an amount', () => {
    const item = { inventoryEntries: [entry({ quantity: 2, unit: 'pcs' })] };
    expect(getTotalContent(item)).toBeNull();
  });

  it('sums quantity * amount in a single unit', () => {
    const item = {
      inventoryEntries: [
        entry({ quantity: 2, amount: 500, unit: 'g' }),
        entry({ quantity: 1, amount: 250, unit: 'g' }),
      ],
    };
    expect(getTotalContent(item)).toEqual({ value: 1250, unit: 'g' });
  });

  it('converts amounts to the most common unit', () => {
    const item = {
      inventoryEntries: [
        entry({ quantity: 1, amount: 1, unit: 'kg' }),
        entry({ quantity: 1, amount: 500, unit: 'g' }),
        entry({ quantity: 1, amount: 250, unit: 'g' }),
      ],
    };
    // g is the most common unit: 1000 + 500 + 250
    expect(getTotalContent(item)).toEqual({ value: 1750, unit: 'g' });
  });

  it('returns null for incompatible units instead of fabricating a total', () => {
    const item = {
      inventoryEntries: [
        entry({ quantity: 2, amount: 500, unit: 'g' }),
        entry({ quantity: 3, amount: 4, unit: 'pcs' }),
      ],
    };
    expect(getTotalContent(item)).toBeNull();
  });
});

describe('coerceEntriesToUnit', () => {
  it('normalizes entry units to the canonical unit', () => {
    const out = coerceEntriesToUnit([entry({ quantity: 1, unit: 'Liter' })], 'l');
    expect(out[0].unit).toBe('l');
  });

  it('converts per-package amounts but never package counts', () => {
    const out = coerceEntriesToUnit([entry({ quantity: 2, amount: 500, unit: 'g' })], 'kg');
    expect(out[0].quantity).toBe(2);
    expect(out[0].amount).toBe(0.5);
    expect(out[0].unit).toBe('kg');
  });

  it('keeps entries with incompatible units separate, unconverted', () => {
    const out = coerceEntriesToUnit([entry({ quantity: 3, amount: 4, unit: 'pcs' })], 'g');
    expect(out[0].quantity).toBe(3);
    expect(out[0].amount).toBe(4);
    expect(out[0].unit).toBe('pcs');
  });

  it('fills an empty unit with the canonical unit', () => {
    const out = coerceEntriesToUnit([entry({ quantity: 1, unit: '' })], 'bag');
    expect(out[0].unit).toBe('bag');
  });
});

describe('consumeFromEntries', () => {
  it('reduces quantities across entries in order and drops zeroed entries', () => {
    const entries = [entry({ id: 'a', quantity: 2 }), entry({ id: 'b', quantity: 3 })];
    const out = consumeFromEntries(entries, 4);
    expect(out.map((e) => [e.id, e.quantity])).toEqual([['b', 1]]);
  });

  it('returns a copy unchanged when packages is zero or negative', () => {
    const entries = [entry({ quantity: 2 })];
    expect(consumeFromEntries(entries, 0)).toHaveLength(1);
    expect(consumeFromEntries(entries, -5)).toHaveLength(1);
  });

  it('empties the list when consuming more than available', () => {
    const entries = [entry({ quantity: 2 })];
    expect(consumeFromEntries(entries, 10)).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const entries = [entry({ id: 'a', quantity: 2 })];
    consumeFromEntries(entries, 1);
    expect(entries[0].quantity).toBe(2);
    expect(entries).toHaveLength(1);
  });
});
