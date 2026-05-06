export const CATEGORIES = [
  "Produce",
  "Dairy & Eggs",
  "Meat & Seafood",
  "Pantry",
  "Frozen",
  "Beverages",
  "Snacks",
  "Household",
  "Dog Supplies",
  "Other"
] as const;

export type Category = typeof CATEGORIES[number];

export const PRESET_LOCATIONS = [
  "Main floor refrigerator",
  "Dining table",
  "Main floor pantry",
  "Basement freezer",
  "Basement refrigerator",
  "Basement pantry",
  "Laundry",
  "Master bathroom"
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
  dateBought?: string;
  dateAdded?: string;
  label?: string;
  tags?: string[];
  isOpened?: boolean;
  openedDate?: string;
}

export interface PriceEntry {
  id: string;
  date: string;
  price: number;
  quantity: number;
  unitStr: string;
  store: string;
  isDiscount?: boolean;
  dealPrice?: number;
  dealQuantity?: number;
}

export interface GroceryItem {
  id?: string;
  name: string;
  category: Category;
  inventoryQuantity: number;
  inventoryEntries?: InventoryEntry[];
  shoppingQuantity: number;
  shoppingStore?: string;
  unprocessedQuantity?: number;
  unit?: string;
  locations?: string[];
  location?: string; // Backwards compatibility
  notes: string;
  priceHistory?: PriceEntry[];
  isHiddenSuggestion?: boolean;
  listId: string;
  creatorId: string;
  createdAt?: string | unknown;
  updatedAt?: string | unknown;
}
