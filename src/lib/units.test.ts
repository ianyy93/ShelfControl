import { describe, it, expect } from 'vitest';
import { COMMON_UNITS, normalizeUnit, convertQuantityToUnit, pluralizeUnit, amountPlaceholder, displayUnit, formatUnitValue } from './units.ts';

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

describe('displayUnit', () => {
  it('restores display casing for metric units', () => {
    expect(displayUnit('ml')).toBe('mL');
    expect(displayUnit('mL')).toBe('mL');
    expect(displayUnit('l')).toBe('L');
    expect(displayUnit('L')).toBe('L');
    expect(displayUnit('kg')).toBe('kg');
  });

  it('passes custom units through as typed', () => {
    expect(displayUnit('bag')).toBe('bag');
    expect(displayUnit('')).toBe('pcs');
  });
});

describe('pluralizeUnit', () => {
  it('pluralizes natural package units', () => {
    expect(pluralizeUnit('bag', 1)).toBe('bag');
    expect(pluralizeUnit('bag', 2)).toBe('bags');
    expect(pluralizeUnit('box', 2)).toBe('boxes');
    expect(pluralizeUnit('bottle', 3)).toBe('bottles');
    expect(pluralizeUnit('head', 2)).toBe('heads');
  });

  it('singularizes known plurals when count is 1', () => {
    expect(pluralizeUnit('bags', 1)).toBe('bag');
    expect(pluralizeUnit('boxes', 1)).toBe('box');
  });

  it('handles pcs specially', () => {
    expect(pluralizeUnit('pcs', 1)).toBe('pc');
    expect(pluralizeUnit('pcs', 2)).toBe('pcs');
    expect(pluralizeUnit('pieces', 2)).toBe('pcs');
  });

  it('never pluralizes metric abbreviations', () => {
    expect(pluralizeUnit('kg', 2)).toBe('kg');
    expect(pluralizeUnit('g', 1)).toBe('g');
    expect(pluralizeUnit('mL', 2)).toBe('mL');
    expect(pluralizeUnit('L', 1)).toBe('L');
  });

  it('applies the pragmatic default rule to unknown units', () => {
    expect(pluralizeUnit('jar', 2)).toBe('jars');
    expect(pluralizeUnit('jars', 2)).toBe('jars');
    expect(pluralizeUnit('jar', 1)).toBe('jar');
  });
});

describe('amountPlaceholder', () => {
  it('returns per-unit placeholders', () => {
    expect(amountPlaceholder('g')).toBe('e.g. 500');
    expect(amountPlaceholder('kg')).toBe('e.g. 2');
    expect(amountPlaceholder('lb')).toBe('e.g. 1');
    expect(amountPlaceholder('oz')).toBe('e.g. 8');
    expect(amountPlaceholder('mL')).toBe('e.g. 500');
    expect(amountPlaceholder('L')).toBe('e.g. 1');
    expect(amountPlaceholder('pcs')).toBe('e.g. 12');
  });

  it('falls back for unknown or missing units', () => {
    expect(amountPlaceholder('bag')).toBe('e.g. 1');
    expect(amountPlaceholder('')).toBe('e.g. 1');
    expect(amountPlaceholder()).toBe('e.g. 1');
  });
});

describe('formatUnitValue', () => {
  it('rounds to 2 decimals and strips trailing zeros', () => {
    expect(formatUnitValue(1)).toBe('1');
    expect(formatUnitValue(1.5)).toBe('1.5');
    expect(formatUnitValue(1.234)).toBe('1.23');
    expect(formatUnitValue(0.333333)).toBe('0.33');
    expect(formatUnitValue(1000)).toBe('1000');
  });

  it('returns empty string for non-finite values', () => {
    expect(formatUnitValue(NaN)).toBe('');
    expect(formatUnitValue(Infinity)).toBe('');
  });
});
