import { describe, it, expect } from 'vitest';
import { COMMON_UNITS, normalizeUnit, convertQuantityToUnit } from './units.ts';

describe('normalizeUnit', () => {
  it('maps aliases to canonical units', () => {
    expect(normalizeUnit('kilograms')).toBe('kg');
    expect(normalizeUnit('KILO')).toBe('kg');
    expect(normalizeUnit('pieces')).toBe('pcs');
    expect(normalizeUnit('Each')).toBe('pcs');
    expect(normalizeUnit('mL')).toBe('ml');
    expect(normalizeUnit('LITRE')).toBe('l');
    expect(normalizeUnit('lbs')).toBe('lb');
    expect(normalizeUnit('Ounces')).toBe('oz');
  });

  it('is idempotent on canonical units', () => {
    for (const u of COMMON_UNITS) {
      expect(normalizeUnit(u)).toBe(u.toLowerCase());
    }
    expect(normalizeUnit('kg')).toBe('kg');
    expect(normalizeUnit('pcs')).toBe('pcs');
  });

  it('trims whitespace and lowercases', () => {
    expect(normalizeUnit('  Kg ')).toBe('kg');
  });

  it('passes unknown units through instead of coercing them', () => {
    expect(normalizeUnit('bag')).toBe('bag');
    expect(normalizeUnit('bunch')).toBe('bunch');
    expect(normalizeUnit('Custom Unit')).toBe('custom unit');
  });

  it('defaults empty input to pcs', () => {
    expect(normalizeUnit('')).toBe('pcs');
    expect(normalizeUnit(null)).toBe('pcs');
    expect(normalizeUnit(undefined)).toBe('pcs');
    expect(normalizeUnit('   ')).toBe('pcs');
  });
});

describe('convertQuantityToUnit', () => {
  it('converts within the mass family', () => {
    expect(convertQuantityToUnit(2, 'kg', 'g')).toBe(2000);
    expect(convertQuantityToUnit(500, 'g', 'kg')).toBe(0.5);
    expect(convertQuantityToUnit(1, 'lb', 'oz')).toBe(16);
  });

  it('converts within the volume family', () => {
    expect(convertQuantityToUnit(1500, 'ml', 'l')).toBe(1.5);
    expect(convertQuantityToUnit(2, 'L', 'ml')).toBe(2000);
  });

  it('returns the value unchanged for identical units', () => {
    expect(convertQuantityToUnit(3, 'kg', 'kilograms')).toBe(3);
    expect(convertQuantityToUnit(3, 'pcs', 'pcs')).toBe(3);
  });

  it('returns null for incompatible units', () => {
    expect(convertQuantityToUnit(2, 'pcs', 'g')).toBeNull();
    expect(convertQuantityToUnit(2, 'kg', 'l')).toBeNull();
    expect(convertQuantityToUnit(2, 'bag', 'g')).toBeNull();
  });

  it('returns null for non-positive or non-finite values', () => {
    expect(convertQuantityToUnit(0, 'kg', 'g')).toBeNull();
    expect(convertQuantityToUnit(-2, 'kg', 'g')).toBeNull();
    expect(convertQuantityToUnit(NaN, 'kg', 'g')).toBeNull();
  });
});
