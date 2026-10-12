import { describe, it, expect } from 'vitest';
import { buildReceiptPriceEntry, deriveUnitPrice, parseReceiptText, resolveReceiptDate } from './receipt.ts';
import { normalizeUnit } from './units.ts';
import { filterValidInventoryEntries } from './inventory.ts';
import { getAvailableUnopenedStock, getEffectiveRestockTarget, isItemBelowRestockTarget } from './restock.ts';

describe('normalizeUnit', () => {
  it('normalizes common unit aliases', () => {
    expect(normalizeUnit('kilograms')).toBe('kg');
    expect(normalizeUnit('pieces')).toBe('pcs');
    expect(normalizeUnit('mL')).toBe('ml');
  });
});

describe('deriveUnitPrice', () => {
  it('derives per-unit prices from receipt totals', () => {
    const result = deriveUnitPrice({
      totalPrice: 5,
      priceQuantity: 2.5,
      priceUnit: 'kg',
      quantity: 2.5,
      quantityUnit: 'kg',
    });

    expect(result.unitPrice).toBe(2);
    expect(result.priceUnit).toBe('kg');
  });

  it('prefers an explicit unit price when provided', () => {
    const result = deriveUnitPrice({
      totalPrice: 5,
      unitPrice: 3.49,
      priceQuantity: 2.5,
      priceUnit: 'kg',
      quantity: 2.5,
      quantityUnit: 'kg',
    });

    expect(result.unitPrice).toBe(3.49);
    expect(result.totalPrice).toBe(5);
  });
});

describe('resolveReceiptDate', () => {
  it('prefers the uploaded image date when OCR returns an older year', () => {
    const resolved = resolveReceiptDate('2024-08-06', {
      fallbackDate: '2026-08-06',
      fileDate: '2026-08-06',
    });

    expect(resolved).toBe('2026-08-06');
  });
});

describe('buildReceiptPriceEntry', () => {
  it('uses the receipt price basis quantity for price history entries', () => {
    const entry = buildReceiptPriceEntry({
      store: 'Fresh Market',
      date: '2026-08-06',
      totalPrice: 12.5,
      unitPrice: 2.5,
      priceQuantity: 5,
      priceUnit: 'kg',
      quantity: 5,
      quantityUnit: 'kg',
    });

    expect(entry.quantity).toBe(5);
    expect(entry.unitStr).toBe('kg');
    expect(entry.price).toBe(2.5);
  });
});

describe('parseReceiptText', () => {
  it('parses a simple receipt text row into a deterministic item', () => {
    const parsed = parseReceiptText(
      `BROCCOLI 1.5 kg $4.99\nBANANAS 2.00 $1.50\nTOTAL $6.49`
    );

    expect(parsed.items.length >= 2).toBe(true);
    expect(parsed.items[0].name.toLowerCase().includes('broccoli')).toBe(true);
    expect(parsed.items[0].quantity).toBe(1.5);
    expect(parsed.items[0].unit).toBe('kg');
    expect(parsed.items[0].price).toBe(4.99);
  });

  it('falls back to pcs when the receipt contains counted items without a unit', () => {
    const parsed = parseReceiptText(`APPLES 3 $2.49\nORANGES 4 $3.25`);

    expect(parsed.items[0].unit).toBe('pcs');
    expect(parsed.items[0].quantity).toBe(3);
    expect(parsed.items[0].price).toBe(2.49);
  });
});

describe('restock', () => {
  it('category defaults apply when item target is missing and zero-stock alerts are triggered at 0', () => {
    const item = {
      name: 'Carrots',
      category: 'vegetables',
      inventoryQuantity: 0,
      shoppingQuantity: 0,
      notes: '',
      listId: 'list-1',
      creatorId: 'u1',
      restockPolicy: 'essential' as const,
      inventoryEntries: [{ id: 'e1', location: '', quantity: 0, isOpened: false }],
    };

    expect(getEffectiveRestockTarget(item as any)).toBe(3);
    expect(getAvailableUnopenedStock(item as any)).toBe(0);
    expect(isItemBelowRestockTarget(item as any)).toBe(true);
  });
});

describe('filterValidInventoryEntries', () => {
  it('keeps unopened pcs entries when an opened entry is reduced to zero', () => {
    const entries = [
      { id: 'opened-1', location: '', quantity: 0, unit: 'pcs', isOpened: true, amount: undefined },
      { id: 'unopened-1', location: '', quantity: 2, unit: 'pcs', isOpened: false },
      { id: 'unopened-2', location: '', quantity: 1, unit: 'pcs', isOpened: false },
    ] as any;

    const remaining = filterValidInventoryEntries(entries).map(e => e.id);
    expect(remaining).toEqual(['unopened-1', 'unopened-2']);
  });
});
