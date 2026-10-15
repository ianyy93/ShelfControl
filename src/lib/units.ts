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
 * Display casing for canonical units ("ml" -> "mL", "l" -> "L").
 * Custom units pass through as the user typed them.
 */
export function displayUnit(unit?: string | null): string {
  const u = normalizeUnit(unit);
  if (u === "ml") return "mL";
  if (u === "l") return "L";
  return u;
}

/** Known plural -> singular pairs for natural package units. */
const KNOWN_PLURALS: Record<string, string> = {
  bags: "bag",
  boxes: "box",
  bottles: "bottle",
  heads: "head",
  pieces: "piece",
  counts: "count",
  cartons: "carton",
  cans: "can",
  jars: "jar",
  packs: "pack",
  bundles: "bundle",
  bars: "bar",
  tubes: "tube",
};

/**
 * Human display unit for a package count: "1 bag" / "2 bags",
 * "1 box" / "2 boxes", "1 pc" / "2 pcs". Metric abbreviations
 * (kg, g, mL, ...) never pluralize. Unknown units follow the pragmatic
 * default: singularize a known plural when count is 1, otherwise append
 * "s" unless the unit already ends in "s".
 */
export function pluralizeUnit(unit: string, count: number): string {
  const u = normalizeUnit(unit);
  if (u === "pcs") return count === 1 ? "pc" : "pcs";
  if (u === "kg" || u === "g" || u === "lb" || u === "oz") return u;
  if (u === "ml" || u === "l") return displayUnit(u);
  if (count === 1) return KNOWN_PLURALS[u] ?? u;
  if (u.endsWith("s")) return u;
  if (/(x|sh|ch)$/.test(u)) return u + "es";
  return u + "s";
}

/** Sensible per-unit placeholder for the "amount per package" input. */
const AMOUNT_PLACEHOLDERS: Record<string, string> = {
  g: "e.g. 500",
  kg: "e.g. 2",
  lb: "e.g. 1",
  oz: "e.g. 8",
  ml: "e.g. 500",
  l: "e.g. 1",
  pcs: "e.g. 12",
};

export function amountPlaceholder(unit?: string | null): string {
  const raw = String(unit ?? "").trim();
  if (!raw) return "e.g. 1";
  return AMOUNT_PLACEHOLDERS[normalizeUnit(raw)] ?? "e.g. 1";
}

/** Format a unit value for display: rounds to 2 decimals, strips trailing zeros. */
export function formatUnitValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
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
