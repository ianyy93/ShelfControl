export const CATEGORIES = [
  "Produce",
  "Dairy & Eggs",
  "Meat & Seafood",
  "Pantry",
  "Frozen",
  "Beverages",
  "Snacks",
  "Household",
  "Other"
] as const;

export const PRESET_LOCATIONS = [
  "MR (Main floor refrigerator)",
  "DT (Dining table)",
  "MP (Main floor pantry)",
  "BF (Basement freezer)",
  "BR (Basement refrigerator)",
  "BP (Basement pantry)",
  "L (Laundry)",
  "MB (Master bathroom)"
];

export interface GroceryList {
  id?: string;
  name: string;
  ownerId: string;
  members: string[];
  createdAt?: string | unknown;
  updatedAt?: string | unknown;
}

export interface InventoryEntry {
  id: string;
  location: string;
  quantity: number;
  amount?: number;
  unit?: string;
  expiryDate?: string;
  label?: string;
  tags?: string[];
}

export interface PriceEntry {
  id: string;
  date: string;
  price: number;
  unitStr: string;
  store: string;
}

export interface GroceryItem {
  id?: string;
  name: string;
  category: Category;
  inventoryQuantity: number;
  inventoryEntries?: InventoryEntry[];
  shoppingQuantity: number;
  unprocessedQuantity?: number;
  unit?: string;
  locations?: string[];
  location?: string; // Backwards compatibility
  notes: string;
  priceHistory?: PriceEntry[];
  listId: string;
  creatorId: string;
  createdAt?: string | unknown;
  updatedAt?: string | unknown;
}
