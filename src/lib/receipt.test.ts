import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveUnitPrice, normalizeUnit } from './receipt.ts';

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
