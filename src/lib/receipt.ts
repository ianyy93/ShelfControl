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

export function parseReceiptText(rawText: string): { store?: string; dateBought?: string; items: Array<{ name: string; quantity: number; unit: string; category: string; price: number; unitPrice?: number; priceQuantity?: number; priceUnit?: string; notes?: string; entries?: Array<{ quantity: number; unit: string }> }> } {
  const text = String(rawText || "").replace(/\r/g, "").trim();
  if (!text) {
    return { items: [] };
  }

  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  const items: Array<{ name: string; quantity: number; unit: string; category: string; price: number; unitPrice?: number; priceQuantity?: number; priceUnit?: string; notes?: string; entries?: Array<{ quantity: number; unit: string }> }> = [];

  const classifyItem = (name: string) => {
    const lower = name.toLowerCase();
    if (/milk|yogurt|cheese|butter|cream|egg|eggs/.test(lower)) return "Dairy & Eggs";
    if (/beef|chicken|pork|fish|salmon|tuna|shrimp|seafood|steak/.test(lower)) return "Meat & Seafood";
    if (/apple|banana|orange|grape|lettuce|spinach|broccoli|carrot|tomato|pepper|onion|cucumber|celery|avocado|berry|kiwi|melon|fruit|veg|vegetable/.test(lower)) return "Produce";
    if (/beer|wine|juice|water|soda|tea|coffee|energy|milk|drink/.test(lower)) return "Beverages";
    if (/chip|cracker|cookie|snack|candy|nuts|pretzel/.test(lower)) return "Snacks";
    if (/soap|toilet|paper|detergent|cleaner|shampoo|trash|laundry|dish/.test(lower)) return "Household";
    if (/dog|pet|cat|treat|food/.test(lower)) return "Dog Supplies";
    if (/rice|pasta|sauce|beans|oil|flour|cereal|soup|canned|jar|bottle|tuna/.test(lower)) return "Pantry";
    if (/frozen|ice cream|veggie|pizza|peas/.test(lower)) return "Frozen";
    return "Other";
  };

  const parseMoney = (token: string | undefined): number | undefined => {
    if (!token) return undefined;
    const cleaned = token.replace(/[^0-9.\-]/g, "");
    if (!cleaned || Number.isNaN(Number(cleaned))) return undefined;
    return Number(cleaned);
  };

  for (const line of lines) {
    const priceMatch = line.match(/\$?\s?(\d+(?:\.\d{1,2})?)\s*$/);
    if (!priceMatch) continue;

    const price = parseMoney(priceMatch[1]);
    if (typeof price !== "number") continue;

    const left = line.slice(0, line.lastIndexOf(priceMatch[0])).trim();
    if (!left) continue;

    const quantityMatch = left.match(/^(.*?)(?:\s+|)(\d+(?:\.\d+)?)\s*(kg|g|lb|oz|ml|l|pcs|pc|piece|pieces|ea|each)?(?:\s+|$)/i);

    let quantity = 1;
    let unit = "pcs";
    let name = left;

    if (quantityMatch) {
      const maybeName = quantityMatch[1]?.trim();
      const qty = Number(quantityMatch[2]);
      const rawUnit = quantityMatch[3]?.trim();
      if (maybeName) name = maybeName;
      if (Number.isFinite(qty)) quantity = qty;
      if (rawUnit) unit = normalizeUnit(rawUnit);
    } else {
      const nameNumberMatch = left.match(/^(.*?)(?:\s+|)(\d+(?:\.\d+)?)\s*$/);
      if (nameNumberMatch && nameNumberMatch[1]) {
        name = nameNumberMatch[1].trim();
        quantity = Number(nameNumberMatch[2]) || 1;
      }
    }

    const normalizedName = name.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").trim();
    if (!normalizedName) continue;

    items.push({
      name: normalizedName,
      quantity,
      unit,
      category: classifyItem(normalizedName),
      price,
      unitPrice: undefined,
      priceQuantity: quantity,
      priceUnit: unit,
      notes: "Parsed from receipt text fallback",
      entries: [{ quantity, unit }],
    });
  }

  return { items };
}
