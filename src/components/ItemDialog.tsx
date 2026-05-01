import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { X, Plus, Trash2 } from "lucide-react";
import { GroceryItem, CATEGORIES, Category, InventoryEntry, PriceEntry } from "../types";
import { Badge } from "./ui/badge";

interface ItemDialogProps {
  item?: GroceryItem;
  existingItems?: GroceryItem[];
  locations?: string[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (item: Partial<GroceryItem> & { newPriceEntry?: Omit<PriceEntry, 'id'>, processQuantity?: number }) => Promise<void>;
  title: string;
  defaultMode: 'shopping' | 'inventory';
}

function TagInput({ tags, onChange }: { tags: string[], onChange: (tags: string[]) => void }) {
  const [inputValue, setInputValue] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      if (!tags.includes(inputValue.trim())) {
        onChange([...tags, inputValue.trim()]);
      }
      setInputValue("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(tags.filter(t => t !== tagToRemove));
  };

  return (
    <div className="space-y-2">
      <Input 
        type="text" 
        value={inputValue} 
        onChange={e => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type tag and press Enter"
        className="h-8 text-sm bg-white"
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <Badge key={tag} variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 pr-1 py-0.5">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="ml-1 hover:bg-blue-200 rounded-full p-0.5">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function ItemDialog({ item, existingItems, locations = [], isOpen, onOpenChange, onSave, title, defaultMode }: ItemDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("Produce");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<'shopping' | 'inventory' | 'prices'>(defaultMode);
  
  // Internal state for edits
  const [shoppingQuantity, setShoppingQuantity] = useState<string | number>(0);
  const [inventoryEntries, setInventoryEntries] = useState<InventoryEntry[]>([]);

  const [loading, setLoading] = useState(false);

  const selectStyles = "flex h-8 w-full items-center justify-between whitespace-nowrap rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50";

  const [price, setPrice] = useState("");
  const [store, setStore] = useState("");
  const [priceDate, setPriceDate] = useState(new Date().toISOString().split('T')[0]);
  const [priceUnit, setPriceUnit] = useState("");
  
  const [isDiscount, setIsDiscount] = useState(false);
  const [dealPrice, setDealPrice] = useState("");
  const [dealQuantity, setDealQuantity] = useState("");

  const [processQuantity, setProcessQuantity] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      setPrice("");
      setStore("");
      setPriceUnit("");
      setPriceDate(new Date().toISOString().split('T')[0]);
      setIsDiscount(false);
      setDealPrice("");
      setDealQuantity("");
      setProcessQuantity(0);
      if (item) {
        setName(item.name);
        setCategory(item.category);
        setUnit(item.unit || "");
        setNotes(item.notes || "");
        setShoppingQuantity(item.shoppingQuantity || 0);
        setInventoryEntries(item.inventoryEntries || []);
        
        if (item.unprocessedQuantity && item.unprocessedQuantity > 0) {
          setProcessQuantity(item.unprocessedQuantity);
        }

        // Set mode to whatever it has positive quantity for, or keep default
        if (defaultMode === 'shopping') {
            setMode('shopping');
        } else if (defaultMode === 'inventory') {
            setMode('inventory');
        } else {
            setMode('prices');
        }
      } else {
        setName("");
        setCategory("Produce");
        setUnit("");
        setNotes("");
        setShoppingQuantity(0);
        setInventoryEntries([]);
        if (defaultMode === 'shopping') {
            setShoppingQuantity(1);
        } else if (defaultMode === 'inventory') {
            setInventoryEntries([{ id: Math.random().toString(36).substr(2, 9), location: "", quantity: 1, unit }]);
        }
        setMode(defaultMode);
      }
    }
  }, [isOpen, item, defaultMode]);

  const handleUnitChange = (val: string) => {
    setUnit(val);
    // Automatically apply the new unit to entries that don't have a unit, or update them if they match the old unit
    setInventoryEntries(entries => entries.map(e => ({
      ...e,
      unit: (!e.unit || e.unit === unit) ? val : e.unit
    })));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    let derivedInventoryQuant = 0;
    const derivedLocations = new Set<string>();
    
    inventoryEntries.forEach(entry => {
        derivedInventoryQuant += Number(entry.quantity) || 0;
        if (entry.location && entry.location.trim()) {
            derivedLocations.add(entry.location.trim());
        }
    });

    const updateData: Partial<GroceryItem> & { newPriceEntry?: Omit<PriceEntry, 'id'>, processQuantity?: number } = {
      name,
      category,
      unit,
      locations: Array.from(derivedLocations),
      notes,
      inventoryEntries,
      inventoryQuantity: derivedInventoryQuant,
      shoppingQuantity: Number(shoppingQuantity) || 0
    };

    if (item && item.unprocessedQuantity && item.unprocessedQuantity > 0) {
      updateData.processQuantity = processQuantity;
    }

    let finalPrice = Number(price);
    if (isDiscount && dealPrice && dealQuantity && Number(dealQuantity) > 0) {
      finalPrice = Number(dealPrice) / Number(dealQuantity);
    }

    if ((price || isDiscount) && store) {
      updateData.newPriceEntry = {
        date: priceDate,
        price: finalPrice,
        store,
        unitStr: priceUnit || unit || "",
        ...(isDiscount ? {
          isDiscount: true,
          dealPrice: Number(dealPrice),
          dealQuantity: Number(dealQuantity)
        } : {})
      };
    }

    try {
      await onSave(updateData);
    } catch (err: any) {
      console.error("ItemDialog onSave error:", err);
      alert("Save failed:\nPayload: " + JSON.stringify(updateData) + "\nError: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const addInventoryEntry = () => {
    const today = new Date().toISOString().split('T')[0];
    setInventoryEntries([...inventoryEntries, { 
      id: Math.random().toString(36).substr(2, 9), 
      location: "", 
      quantity: 1, 
      unit: unit || item?.unit || "",
      dateBought: today,
      dateAdded: today
    }]);
  };

  const removeInventoryEntry = (id: string) => {
    setInventoryEntries(inventoryEntries.filter(e => e.id !== id));
  };

  const updateInventoryEntry = (id: string, field: keyof InventoryEntry, value: string | number | string[]) => {
    setInventoryEntries(inventoryEntries.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const applyCategoryMapping = (itemName: string) => {
    if (existingItems) {
        const match = existingItems.find(i => i.name.toLowerCase().trim() === itemName.toLowerCase().trim());
        if (match) {
          setCategory(match.category);
          if (match.unit) setUnit(match.unit);
          return true;
        }
    }
    return false;
  };

  const handleNameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    applyCategoryMapping(val);
  };

  const handleModeChange = (v: string) => {
    const newMode = v as 'shopping'|'inventory'|'prices';
    setMode(newMode);
    if (!item) {
        if (newMode === 'shopping') {
            if (Number(shoppingQuantity) === 0) setShoppingQuantity(1);
            setInventoryEntries([]);
        } else if (newMode === 'inventory') {
            setShoppingQuantity(0);
            if (inventoryEntries.length === 0) {
                setInventoryEntries([{ id: Math.random().toString(36).substr(2, 9), location: "", quantity: 1, unit }]);
            }
        } else if (newMode === 'prices') {
            setShoppingQuantity(0);
            setInventoryEntries([]);
        }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 max-h-[80vh] overflow-y-auto px-1">
          <div className="space-y-3">
             <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Quick Actions / Modes</Label>
             <Tabs value={mode} onValueChange={handleModeChange} className="w-full">
               <TabsList className="grid w-full grid-cols-3">
                 <TabsTrigger value="shopping">Shopping</TabsTrigger>
                 <TabsTrigger value="inventory">Inventory</TabsTrigger>
                 <TabsTrigger value="prices">Price</TabsTrigger>
               </TabsList>
             </Tabs>
          </div>

          {mode === 'inventory' && item && item.unprocessedQuantity && item.unprocessedQuantity > 0 && (
             <div className="bg-orange-50/50 border border-orange-200 p-3 rounded-lg flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex-1">
                   <Label className="text-orange-900 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                     Processing Stock
                   </Label>
                   <p className="text-[10px] text-orange-700 mt-0.5">
                     Decrement {item.unprocessedQuantity} {item.unit} from "To Be Processed" queue.
                   </p>
                </div>
                <div className="space-y-1 text-right max-w-[100px]">
                   <Label className="text-[10px] text-orange-800 uppercase font-semibold">Amount</Label>
                   <Input 
                     type="number" step="any" min="0" max={item.unprocessedQuantity}
                     value={processQuantity} 
                     onChange={e => setProcessQuantity(Number(e.target.value))} 
                     className="h-8 text-sm bg-white border-orange-200 focus:ring-orange-500"
                   />
                </div>
             </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Item Name</Label>
            <div className="space-y-2">
              <Input 
                id="name" 
                value={name} 
                onChange={handleNameInputChange} 
                required 
                placeholder="Type item name..." 
                list="items-list"
              />
              <datalist id="items-list">
                {Array.from(new Set(existingItems?.map(i => i.name)))
                  .sort()
                  .map(n => <option key={n} value={n} />)
                }
              </datalist>
            </div>
          </div>
          
          <div className={`grid gap-3 items-end ${mode === 'shopping' ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="space-y-2">
                <Label htmlFor="category" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Category</Label>
                <select 
                  id="category"
                  className={selectStyles}
                  value={category} 
                  onChange={e => setCategory(e.target.value as Category)}
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              {mode === 'shopping' ? (
                <div className="space-y-2">
                  <Label htmlFor="shopping-quantity" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Shopping Qty</Label>
                  <Input 
                    id="shopping-quantity"
                    type="number" 
                    step="any" 
                    min="0" 
                    value={shoppingQuantity} 
                    onChange={e => setShoppingQuantity(e.target.value)} 
                    required={mode==='shopping'} 
                    className="h-8"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="unit" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Unit</Label>
                  <Input 
                    id="unit" 
                    value={unit} 
                    onChange={e => handleUnitChange(e.target.value)} 
                    list="units-list" 
                    placeholder="pcs, kg..." 
                    className="h-8"
                  />
                </div>
              )}
              {mode === 'shopping' && (
                <div className="space-y-2">
                  <Label htmlFor="unit" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Unit</Label>
                  <Input 
                    id="unit" 
                    value={unit} 
                    onChange={e => handleUnitChange(e.target.value)} 
                    list="units-list" 
                    placeholder="pcs..." 
                    className="h-8"
                  />
                </div>
              )}
          </div>

          {mode === 'inventory' && (
             <div className="space-y-3">
               <div className="flex justify-between items-center">
                 <Label>Inventory Details</Label>
                 <Button type="button" variant="outline" size="sm" onClick={addInventoryEntry} className="h-7 text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Add Entry
                 </Button>
               </div>
               
               {inventoryEntries.map((entry, index) => (
                 <div key={entry.id} className="p-3 bg-gray-50 border rounded-lg space-y-3 relative group">
                   <div className="flex justify-between items-center gap-2">
                     <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Entry #{index + 1}</span>
                     <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-600" onClick={() => removeInventoryEntry(entry.id)}>
                        <Trash2 className="w-4 h-4" />
                     </Button>
                   </div>
                   
                   {/* Row 1: Location, Quantity */}
                   <div className="grid grid-cols-2 gap-3 items-start">
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Location</Label>
                       <Input 
                         value={entry.location} 
                         onChange={e => updateInventoryEntry(entry.id, 'location', e.target.value)} 
                         placeholder="Type location..." 
                         className="h-8 text-sm bg-white"
                         required={mode === 'inventory'}
                         list="locations-list"
                       />
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Quantity (Count)</Label>
                       <Input 
                         type="number" step="any" min="0.01" 
                         value={entry.quantity} 
                         onChange={e => updateInventoryEntry(entry.id, 'quantity', Number(e.target.value))} 
                         className="h-8 text-sm bg-white"
                         placeholder="e.g. 1"
                         required={mode === 'inventory'}
                       />
                     </div>
                   </div>

                   {/* Row 2: Amount, Unit */}
                   <div className="grid grid-cols-2 gap-3 items-start">
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Amount per count</Label>
                       <Input 
                         type="number" step="any" min="0" 
                         value={entry.amount || ""} 
                         onChange={e => updateInventoryEntry(entry.id, 'amount', Number(e.target.value))} 
                         className="h-8 text-sm bg-white"
                         placeholder="e.g. 500"
                       />
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Unit</Label>
                       <Input 
                         value={entry.unit} 
                         onChange={e => updateInventoryEntry(entry.id, 'unit', e.target.value)} 
                         placeholder="Type unit..." 
                         className="h-8 text-sm bg-white"
                         list="units-list"
                       />
                     </div>
                   </div>
                   {/* Row 3: Expiry, Date Bought */}
                   <div className="grid grid-cols-2 gap-3 items-start">
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expiry</Label>
                       <Input type="date" value={entry.expiryDate || ""} onChange={e => updateInventoryEntry(entry.id, 'expiryDate', e.target.value)} className="h-8 text-sm bg-white" />
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date Bought</Label>
                       <Input type="date" value={entry.dateBought || entry.dateAdded || ""} onChange={e => updateInventoryEntry(entry.id, 'dateBought', e.target.value)} className="h-8 text-sm bg-white" />
                     </div>
                   </div>

                   {/* Row 4: Label, Tags */}
                   <div className="grid grid-cols-2 gap-3 items-start">
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Label</Label>
                       <Input type="text" value={entry.label || ""} onChange={e => updateInventoryEntry(entry.id, 'label', e.target.value)} placeholder="e.g. For stir fry" className="h-8 text-sm bg-white" />
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tags</Label>
                       <TagInput tags={entry.tags || []} onChange={(newTags) => updateInventoryEntry(entry.id, 'tags', newTags)} />
                     </div>
                   </div>
                  </div>
                ))}
               {inventoryEntries.length === 0 && (
                 <div className="text-center py-4 text-sm text-gray-500 bg-gray-50 rounded border border-dashed">
                   No inventory entries. Add one to track what you have.
                 </div>
               )}
             </div>
          )}

          {mode === 'prices' && (
              <div className="grid grid-cols-2 gap-3 p-4 bg-blue-50/50 rounded-xl border border-blue-100 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between col-span-2 mb-1">
                  <Label className="font-semibold text-blue-900">Add Price Entry</Label>
                  <span className="text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Tracking</span>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs text-gray-600">Store / Merchant</Label>
                  <Input 
                    value={store} 
                    onChange={e => setStore(e.target.value)} 
                    placeholder="e.g. Costco, Walmart" 
                    className="h-8 text-sm bg-white" 
                    required={mode === 'prices'}
                  />
                </div>
                <div className="flex items-center space-x-2 col-span-2">
                  <input
                    type="checkbox"
                    id="isDiscount"
                    checked={isDiscount}
                    onChange={(e) => setIsDiscount(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Label htmlFor="isDiscount" className="text-xs text-gray-600 cursor-pointer">
                    This is a bulk discount / deal (e.g., buy 2 for $5)
                  </Label>
                </div>

                {!isDiscount ? (
                  <div className="grid grid-cols-2 gap-3 col-span-2 items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600">Price ($)</Label>
                      <Input 
                        type="number" step="0.01" min="0" 
                        value={price} 
                        onChange={e => setPrice(e.target.value)} 
                        placeholder="2.99" 
                        className="h-8 text-sm bg-white" 
                        required={mode === 'prices' && !isDiscount}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600">Unit for price</Label>
                      <Input 
                        type="text" 
                        value={priceUnit} 
                        onChange={e => setPriceUnit(e.target.value)} 
                        placeholder={unit || "pcs"} 
                        className="h-8 text-sm bg-white" 
                      />
                    </div>
                  </div>
                ) : (
                  <div className="col-span-2 space-y-3">
                    <div className="grid grid-cols-2 gap-3 items-end">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">Deal Price ($)</Label>
                        <Input 
                          type="number" step="0.01" min="0" 
                          value={dealPrice} 
                          onChange={e => setDealPrice(e.target.value)} 
                          placeholder="e.g. 5.00" 
                          className="h-8 text-sm bg-white" 
                          required={mode === 'prices' && isDiscount}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">Deal Quantity</Label>
                        <Input 
                          type="number" step="any" min="0" 
                          value={dealQuantity} 
                          onChange={e => setDealQuantity(e.target.value)} 
                          placeholder="e.g. 2" 
                          className="h-8 text-sm bg-white" 
                          required={mode === 'prices' && isDiscount}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600">Unit for quantity</Label>
                      <Input 
                        type="text" 
                        value={priceUnit} 
                        onChange={e => setPriceUnit(e.target.value)} 
                        placeholder={unit || "pcs"} 
                        className="h-8 text-sm bg-white" 
                      />
                    </div>
                    {dealPrice && dealQuantity && Number(dealQuantity) > 0 && (
                      <div className="text-xs font-medium text-blue-800 bg-blue-100/50 p-2 rounded border border-blue-200">
                        Calculated Unit Price: ${ (Number(dealPrice) / Number(dealQuantity)).toFixed(2) } / {priceUnit || unit || "unit"}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs text-gray-600">Date of observation</Label>
                  <Input 
                    type="date" 
                    value={priceDate} 
                    onChange={e => setPriceDate(e.target.value)} 
                    className="h-8 text-sm bg-white" 
                  />
                </div>
              </div>
          )}

          <div className="space-y-4 border-t pt-4">
            <datalist id="locations-list">
              {locations.map(loc => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
            <datalist id="units-list">
              {["g", "kg", "ml", "L", "oz", "lb", "unit", "pack", "bottle", "can", "box", "bag"].map(u => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea 
                id="notes" 
                value={notes} 
                onChange={e => setNotes(e.target.value)} 
                placeholder="e.g. 200g needed for recipe" 
              />
            </div>
          </div>

          <Button type="submit" className="w-full mt-6" disabled={loading}>
            {loading ? "Saving..." : "Save Item"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
