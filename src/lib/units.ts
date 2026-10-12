// Canonical unit machinery for the whole app.
//
// Locked semantics (Phase 1+2 cleanup):
// - InventoryEntry.quantity = whole-package count (number >= 0)
// - InventoryEntry.amount   = content per package, in entry.unit (optional number)
// - entry.unit              = canonical unit, normalized on every write path
//
// Units are shared infrastructure: inventory, price history, and receipt
// parsing all normalize/convert through these helpers. Package counts are
// NEVER converted between units — only per-package amounts are.

export const COMMON_UNITS = ["pcs", "kg", "g", "lb", "oz", "mL", "L"] as const;

const UNIT_ALIASES: Record<string, string[]> = {
  pcs: ["pcs", "pc", "piece", "pieces", "count", "counts", "each", "ea", "unit", "units"],
  kg: ["kg", "kilogram", "kilograms", "kilo", "kilos"],
  g: ["g", "gram", "grams"],
  lb: ["lb", "lbs", "pound", "pounds"],
  oz: ["oz", "ounce", "ounces"],
  ml: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
  l: ["l", "liter", "liters", "litre", "litres"],
};

const CONVERSION_FACTORS: Record<string, Record<string, number>> = {
  pcs: { pcs: 1 },
  g: { g: 1, kg: 0.001, lb: 0.00220462, oz: 0.035274 },
  kg: { kg: 1, g: 1000, lb: 2.20462, oz: 35.274 },
  lb: { lb: 1, kg: 0.453592, g: 453.592, oz: 16 },
  oz: { oz: 1, lb: 0.0625, kg: 0.0283495, g: 28.3495 },
  ml: { ml: 1, l: 0.001 },
  l: { l: 1, ml: 1000 },
};

/**
 * Map a raw unit string to its canonical form.
 * Unknown units pass through lowercased/trimmed (never coerced to something
 * wrong); empty input defaults to "pcs".
 */
export function normalizeUnit(value?: string | null): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "pcs";

  for (const [canonical, aliases] of Object.entries(UNIT_ALIASES)) {
    if (aliases.includes(raw)) {
      return canonical;
    }
  }

  return raw;
}

/**
 * Convert a per-package amount from one unit to another.
 * Returns the converted value, or null when the units are incompatible
 * (e.g. pcs vs g) or the value is not a positive finite number.
 * Never use this on package counts — counts are unit-agnostic.
 */
export function convertQuantityToUnit(value: number, fromUnit?: string | null, toUnit?: string | null): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const normalizedFrom = normalizeUnit(fromUnit);
  const normalizedTo = normalizeUnit(toUnit);

  if (normalizedFrom === normalizedTo) {
    return value;
  }

  const fromFactors = CONVERSION_FACTORS[normalizedFrom];
  const toFactor = fromFactors?.[normalizedTo];

  if (typeof toFactor === "number") {
    return value * toFactor;
  }

  const reversed = CONVERSION_FACTORS[normalizedTo]?.[normalizedFrom];
  if (typeof reversed === "number") {
    return value / reversed;
  }

  return null;
}
