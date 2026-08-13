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

export function resolveReceiptDate(
  parsedDate?: string | null,
  context?: { fallbackDate?: string | null; fileDate?: string | null }
): string {
  const fallbackDate = context?.fallbackDate || new Date().toISOString().split("T")[0];
  const fileDate = context?.fileDate || null;

  const cleanParsedDate = typeof parsedDate === "string" ? parsedDate.trim() : "";
  const cleanFileDate = typeof fileDate === "string" ? fileDate.trim() : "";

  if (!cleanParsedDate) {
    return cleanFileDate || fallbackDate;
  }

  if (cleanFileDate && cleanParsedDate !== cleanFileDate) {
    const parsedYear = Number(cleanParsedDate.slice(0, 4));
    const fileYear = Number(cleanFileDate.slice(0, 4));
    if (!Number.isNaN(parsedYear) && !Number.isNaN(fileYear) && fileYear >= parsedYear + 2) {
      return cleanFileDate;
    }
  }

  return cleanParsedDate;
}

export function buildReceiptPriceEntry(input: {
  store: string;
  date: string;
  totalPrice?: number;
  unitPrice?: number;
  priceQuantity?: number;
  priceUnit?: string | null;
  quantity?: number;
  quantityUnit?: string | null;
}) {
  const normalizedPriceQuantity = Number(input.priceQuantity ?? input.quantity ?? 1) || 1;
  const normalizedPriceUnit = normalizeUnit(input.priceUnit || input.quantityUnit || "pcs");
  const derived = deriveUnitPrice({
    totalPrice: input.totalPrice,
    unitPrice: input.unitPrice,
    priceQuantity: normalizedPriceQuantity,
    priceUnit: normalizedPriceUnit,
    quantity: input.quantity,
    quantityUnit: input.quantityUnit || normalizedPriceUnit,
  });

  return {
    id: crypto.randomUUID(),
    store: input.store,
    date: input.date,
    price: derived.unitPrice ?? input.totalPrice ?? 0,
    quantity: normalizedPriceQuantity,
    unitStr: normalizedPriceUnit,
  };
}

export function deriveUnitPrice(input: {
  totalPrice?: number;
  unitPrice?: number;
  priceQuantity?: number;
  priceUnit?: string | null;
  quantity?: number;
  quantityUnit?: string | null;
}) {
  const totalPrice = typeof input.totalPrice === "number" ? input.totalPrice : undefined;
  const providedUnitPrice = typeof input.unitPrice === "number" ? input.unitPrice : undefined;
  const priceQuantity = Number(input.priceQuantity ?? input.quantity ?? 1) || 1;
  const priceUnit = normalizeUnit(input.priceUnit || input.quantityUnit || "pcs");
  const quantityUnit = normalizeUnit(input.quantityUnit || input.priceUnit || "pcs");
  const convertedQuantity = convertQuantityToUnit(priceQuantity, quantityUnit, priceUnit) ?? priceQuantity;

  const unitPrice = providedUnitPrice ?? (typeof totalPrice === "number" && convertedQuantity > 0 ? totalPrice / convertedQuantity : undefined);
  const normalizedTotalPrice = typeof totalPrice === "number"
    ? totalPrice
    : typeof unitPrice === "number" && convertedQuantity > 0
      ? unitPrice * convertedQuantity
      : undefined;

  return {
    unitPrice,
    totalPrice: normalizedTotalPrice,
    priceQuantity: convertedQuantity,
    priceUnit,
  };
}
