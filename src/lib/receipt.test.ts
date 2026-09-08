import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptPriceEntry, deriveUnitPrice, normalizeUnit, parseReceiptText, resolveReceiptDate } from './receipt.ts';
import { getAvailableUnopenedStock, getEffectiveRestockTarget, isItemBelowRestockTarget } from './restock.ts';

test('normalizes common unit aliases', () => {
  assert.equal(normalizeUnit('kilograms'), 'kg');
  assert.equal(normalizeUnit('pieces'), 'pcs');
  assert.equal(normalizeUnit('mL'), 'ml');
});

test('derives per-unit prices from receipt totals', () => {
  const result = deriveUnitPrice({
    totalPrice: 5,
    priceQuantity: 2.5,
    priceUnit: 'kg',
    quantity: 2.5,
    quantityUnit: 'kg',
  });

  assert.equal(result.unitPrice, 2);
  assert.equal(result.priceUnit, 'kg');
});

test('prefers an explicit unit price when provided', () => {
  const result = deriveUnitPrice({
    totalPrice: 5,
    unitPrice: 3.49,
    priceQuantity: 2.5,
    priceUnit: 'kg',
    quantity: 2.5,
    quantityUnit: 'kg',
  });

  assert.equal(result.unitPrice, 3.49);
  assert.equal(result.totalPrice, 5);
});

test('prefers the uploaded image date when OCR returns an older year', () => {
  const resolved = resolveReceiptDate('2024-08-06', {
    fallbackDate: '2026-08-06',
    fileDate: '2026-08-06',
  });

  assert.equal(resolved, '2026-08-06');
});

test('uses the receipt price basis quantity for price history entries', () => {
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

  assert.equal(entry.quantity, 5);
  assert.equal(entry.unitStr, 'kg');
  assert.equal(entry.price, 2.5);
});

test('parses a simple receipt text row into a deterministic item', () => {
  const parsed = parseReceiptText(
    `BROCCOLI 1.5 kg $4.99\nBANANAS 2.00 $1.50\nTOTAL $6.49`
  );

  assert.equal(parsed.items.length >= 2, true);
  assert.equal(parsed.items[0].name.toLowerCase().includes('broccoli'), true);
  assert.equal(parsed.items[0].quantity, 1.5);
  assert.equal(parsed.items[0].unit, 'kg');
  assert.equal(parsed.items[0].price, 4.99);
});

test('falls back to pcs when the receipt contains counted items without a unit', () => {
  const parsed = parseReceiptText(`APPLES 3 $2.49\nORANGES 4 $3.25`);

  assert.equal(parsed.items[0].unit, 'pcs');
  assert.equal(parsed.items[0].quantity, 3);
  assert.equal(parsed.items[0].price, 2.49);
});

test('category defaults apply when item target is missing and zero-stock alerts are triggered at 0', () => {
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

  assert.equal(getEffectiveRestockTarget(item as any), 3);
  assert.equal(getAvailableUnopenedStock(item as any), 0);
  assert.equal(isItemBelowRestockTarget(item as any), true);
});
