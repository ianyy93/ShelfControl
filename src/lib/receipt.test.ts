import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptPriceEntry, deriveUnitPrice, normalizeUnit, resolveReceiptDate } from './receipt.ts';

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
