import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { X, Plus, Minus, Trash2, Split } from "lucide-react";
import { GroceryItem, CATEGORIES, Category, InventoryEntry, PriceEntry, RestockPolicy } from "../types";
import { Badge } from "./ui/badge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ItemDialogProps {
  item?: GroceryItem;
  existingItems?: GroceryItem[];
  locations?: string[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (item: Partial<GroceryItem> & { newPriceEntry?: Omit<PriceEntry, 'id'>, processQuantity?: number, editedPriceEntry?: PriceEntry, deletedPriceEntryId?: string }) => Promise<void>;
  title: string;
  defaultMode: 'shopping' | 'inventory' | 'prices';
  focusedEntryId?: string | null;
  focusedPriceId?: string | null;
  restrictedMode?: boolean;
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

const PRESET_UNITS = ["pcs", "g", "kg", "mL", "L"];

const LocationSelect = ({ value, onChange, locations, className }: { value: string, onChange: (v: string) => void, locations: string[], className: string }) => {
  const isOther = value && !locations.includes(value);
  const selectedValue = isOther ? 'Other' : value;
  
  return (
    <div className="space-y-2">
      <select 
        className={className}
        value={selectedValue}
        onChange={(e) => {
          if (e.target.value === 'Other') onChange('Custom Location');
          else onChange(e.target.value);
        }}
        required
      >
        <option value="" disabled>Select location...</option>
        {locations.map(l => <option key={l} value={l}>{l}</option>)}
        <option value="Other">Other (Write in...)</option>
      </select>
      {isOther && (
        <Input 
           value={value === 'Custom Location' ? '' : value} 
           onChange={(e) => onChange(e.target.value)}
           placeholder="Type custom location..." 
           className="h-8 text-sm bg-white animate-in fade-in"
           autoFocus
           required
        />
      )}
    </div>
  );
};

const UnitSelect = ({ value, onChange, className }: { value: string, onChange: (v: string) => void, className: string }) => {
  const isOther = value && !PRESET_UNITS.includes(value);
  const selectedValue = isOther ? 'Other' : value;
  
  return (
    <div className="space-y-2">
      <select 
        className={className}
        value={selectedValue}
        onChange={(e) => {
          if (e.target.value === 'Other') onChange('Custom Unit');
          else onChange(e.target.value);
        }}
      >
        <option value="" disabled>Select unit...</option>
        {PRESET_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        <option value="Other">Other (Write in...)</option>
      </select>
      {isOther && (
        <Input 
           value={value === 'Custom Unit' ? '' : value} 
           onChange={(e) => onChange(e.target.value)}
           placeholder="Type custom unit..." 
           className="h-8 text-sm bg-white animate-in fade-in"
           autoFocus
        />
      )}
    </div>
  );
};

export function ItemDialog({ item, existingItems, locations = [], isOpen, onOpenChange, onSave, title, defaultMode, focusedEntryId, focusedPriceId, restrictedMode }: ItemDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category | string>("Produce");
  const [customCategory, setCustomCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<'shopping' | 'inventory' | 'prices'>(defaultMode);
  
  // Internal state for edits
  const [shoppingQuantity, setShoppingQuantity] = useState<string | number>(0);
  const [shoppingStore, setShoppingStore] = useState("");
  const [inventoryEntries, setInventoryEntries] = useState<InventoryEntry[]>([]);
  const [restockPolicy, setRestockPolicy] = useState<RestockPolicy>('manual');
  const [restockTarget, setRestockTarget] = useState<number>(0);
  const [servingsPerUnit, setServingsPerUnit] = useState<number>(1);

  const [loading, setLoading] = useState(false);

  const selectStyles = "flex h-8 w-full items-center justify-between whitespace-nowrap rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50";

  const [price, setPrice] = useState("");
  const [priceQuantity, setPriceQuantity] = useState("1");
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
      setPriceQuantity("1");
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
        if (!CATEGORIES.includes(item.category as any)) {
          setCategory("Other");
          setCustomCategory(item.category);
        } else {
          setCustomCategory("");
        }
        setUnit(item.unit || "");
        setNotes(item.notes || "");
        setShoppingQuantity(item.shoppingQuantity || 0);
        setShoppingStore(item.shoppingStore || "");
        setInventoryEntries(item.inventoryEntries || []);
        setRestockPolicy(item.restockPolicy || 'manual');
        setRestockTarget(Number(item.restockTarget) || 0);
        setServingsPerUnit(Number(item.servingsPerUnit) || 1);
        
        if (item.unprocessedQuantity && item.unprocessedQuantity > 0) {
          setProcessQuantity(item.unprocessedQuantity);
        }

        if (focusedPriceId) {
            let found = false;
            if (focusedPriceId !== 'new' && item.priceHistory) {
                const priceEntry = item.priceHistory.find(e => e.id === focusedPriceId);
                if (priceEntry) {
                    setPrice(priceEntry.price?.toString() || "");
                    setPriceQuantity(priceEntry.quantity?.toString() || "1");
                    setStore(priceEntry.store || "");
                    setPriceUnit(priceEntry.unitStr || "");
                    setPriceDate(priceEntry.date || new Date().toISOString().split('T')[0]);
                    setIsDiscount(!!priceEntry.isDiscount);
                    setDealPrice(priceEntry.dealPrice?.toString() || "");
                    setDealQuantity(priceEntry.dealQuantity?.toString() || "");
                    found = true;
                }
            }
            if (!found) {
                setPrice("");
                setPriceQuantity("1");
                setStore("");
                setPriceUnit(item.unit || "");
                setPriceDate(new Date().toISOString().split('T')[0]);
                setIsDiscount(false);
                setDealPrice("");
                setDealQuantity("");
            }
            setMode('prices');
        } else if (focusedEntryId) {
            setMode('inventory');
        } else if (defaultMode === 'prices') {
            setMode('prices');
        } else if (defaultMode === 'shopping') {
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
        setShoppingStore("");
        setInventoryEntries([]);
        setRestockPolicy('manual');
        setRestockTarget(0);
        setServingsPerUnit(1);
        if (defaultMode === 'shopping') {
            setShoppingQuantity(1);
        } else if (defaultMode === 'inventory') {
            setInventoryEntries([{ id: Math.random().toString(36).substr(2, 9), location: "", quantity: 1, unit }]);
        }
        if (focusedEntryId) {
            setMode('inventory');
        } else {
            setMode(defaultMode);
        }
      }
      
      if (focusedEntryId) {
         setTimeout(() => {
            const el = document.getElementById(`entry-${focusedEntryId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
                setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2'), 2000);
            }
         }, 300);
      }
    }
  }, [isOpen, item, defaultMode, focusedEntryId, focusedPriceId]);

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

    const finalCategory = (category === "Other" && customCategory) ? customCategory : category;

    const updateData: Partial<GroceryItem> & { newPriceEntry?: Omit<PriceEntry, 'id'>, processQuantity?: number, editedPriceEntry?: PriceEntry } = {
      name,
      category: finalCategory as Category,
      unit,
      locations: Array.from(derivedLocations),
      notes,
      inventoryEntries,
      inventoryQuantity: derivedInventoryQuant,
      shoppingQuantity: Number(shoppingQuantity) || 0,
      shoppingStore,
      restockPolicy,
      restockTarget: Number(restockTarget) || 0,
      servingsPerUnit: Number(servingsPerUnit) || 1
    };

    if (item && item.unprocessedQuantity && item.unprocessedQuantity > 0) {
      updateData.processQuantity = processQuantity;
    }

    let finalPrice = Number(price);
    let finalQuantity = Number(priceQuantity) || 1;
    if (isDiscount && dealPrice && dealQuantity && Number(dealQuantity) > 0) {
      finalPrice = Number(dealPrice);
      finalQuantity = Number(dealQuantity);
    }

    if ((price || isDiscount) && store) {
      const priceData = {
        date: priceDate,
        price: finalPrice,
        quantity: finalQuantity,
        store,
        unitStr: priceUnit || unit || "",
        ...(isDiscount ? {
          isDiscount: true,
          dealPrice: Number(dealPrice),
          dealQuantity: Number(dealQuantity)
        } : {
          isDiscount: false, // Ensure false explicitly in case it was toggled
          dealPrice: null as any,
          dealQuantity: null as any
        })
      };
      
      if (focusedPriceId && focusedPriceId !== 'new') {
          updateData.editedPriceEntry = { ...priceData, id: focusedPriceId };
      } else {
          updateData.newPriceEntry = priceData;
      }
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
    const prevEntry = inventoryEntries.length > 0 ? inventoryEntries[inventoryEntries.length - 1] : null;

    const newId = Math.random().toString(36).substr(2, 9);

    if (prevEntry) {
        const { openedDate: _, ...restPrev } = prevEntry;
        setInventoryEntries([...inventoryEntries, {
            ...restPrev,
            id: newId,
            isOpened: false
        }]);
    } else {
        setInventoryEntries([...inventoryEntries, { 
          id: newId, 
          location: "", 
          quantity: 1, 
          unit: unit || item?.unit || "",
          dateBought: today,
          dateAdded: today
        }]);
    }

    setTimeout(() => {
        const el = document.getElementById(`entry-${newId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  };

  const removeInventoryEntry = (id: string) => {
    setInventoryEntries(inventoryEntries.filter(e => e.id !== id));
  };

  const updateInventoryEntry = (id: string, field: keyof InventoryEntry, value: string | number | string[] | boolean) => {
    const newEntries: InventoryEntry[] = [];
    for (const e of inventoryEntries) {
        if (e.id === id) {
             if (field === 'isOpened' && value === true && e.quantity > 1) {
                  // Auto-split in ItemDialog
                  const remaining = e.quantity - 1;
                  newEntries.push({ ...e, quantity: remaining });
                  newEntries.push({ ...e, id: "temp-" + Date.now() + Math.random(), quantity: 1, isOpened: true, openedDate: new Date().toISOString().split('T')[0] });
             } else {
                  newEntries.push({ ...e, [field]: value });
             }
        } else {
            newEntries.push(e);
        }
    }
    setInventoryEntries(newEntries);
  };

  const splitInventoryEntry = (entry: InventoryEntry) => {
    const newQuantity = entry.quantity > 1 ? 1 : entry.quantity;
    const remainingQuantity = entry.quantity > 1 ? entry.quantity - 1 : entry.quantity;
    const newEntryId = "temp-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
    
    setInventoryEntries(entries => 
      entries.flatMap(e => 
        e.id === entry.id
          ? [ 
              { ...e, quantity: remainingQuantity }, 
              ((entryObj) => { const { openedDate: _, ...rest } = entryObj; return { ...rest, id: newEntryId, quantity: newQuantity, isOpened: false }; })(e)
            ]
          : e
      )
    );
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
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 max-h-[80vh] overflow-y-auto overflow-x-hidden overscroll-none px-1">
          {!restrictedMode && (
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
          )}

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

          {!restrictedMode && (
           <>
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
                    onChange={e => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="restock-policy" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Restock</Label>
                  <select
                    id="restock-policy"
                    className={selectStyles}
                    value={restockPolicy}
                    onChange={e => setRestockPolicy(e.target.value as RestockPolicy)}
                  >
                    <option value="manual">Manual</option>
                    <option value="optional">Optional</option>
                    <option value="essential">Essential</option>
                  </select>
                </div>
                {category === 'Other' && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                     <Label htmlFor="custom-category" className="text-xs font-semibold text-gray-500 uppercase tracking-tight italic">Other Name</Label>
                     <Input 
                       id="custom-category" 
                       placeholder="e.g. Baking Supplies" 
                       className="h-8 italic"
                       value={customCategory}
                       onChange={e => setCustomCategory(e.target.value)}
                     />
                  </div>
                )}
                {mode === 'shopping' ? (
                  <div className="space-y-2">
                    <Label htmlFor="shopping-quantity" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Shopping Qty</Label>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShoppingQuantity(Math.max(0, Number(shoppingQuantity) - 1))}>
                        <Minus className="w-3.5 h-3.5" />
                      </Button>
                      <Input 
                        id="shopping-quantity"
                        type="number" 
                        step="any" 
                        min="0" 
                        value={shoppingQuantity} 
                        onChange={e => setShoppingQuantity(e.target.value)} 
                        required={mode==='shopping'} 
                        className="h-8 text-center px-1"
                      />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShoppingQuantity(Number(shoppingQuantity) + 1)}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="unit" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Unit</Label>
                    <UnitSelect value={unit} onChange={handleUnitChange} className={selectStyles} />
                  </div>
                )}
                {mode === 'shopping' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="unit" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Unit</Label>
                      <UnitSelect value={unit} onChange={handleUnitChange} className={selectStyles} />
                    </div>
                    <div className="space-y-2 col-span-1 sm:col-span-3">
                      <Label className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Store / Merchant</Label>
                      <Input 
                        value={shoppingStore} 
                        onChange={e => setShoppingStore(e.target.value)} 
                        placeholder="e.g. Costco, Walmart" 
                        className={selectStyles}
                        list="stores-list"
                      />
                    </div>
                  </>
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="servings-per-unit" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Servings / Unit</Label>
                <Input
                  id="servings-per-unit"
                  type="number"
                  min="0"
                  step="0.1"
                  value={servingsPerUnit}
                  onChange={e => setServingsPerUnit(Number(e.target.value) || 0)}
                  className="h-8"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="restock-target" className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Restock Target</Label>
                <Input
                  id="restock-target"
                  type="number"
                  min="0"
                  step="0.1"
                  value={restockTarget}
                  onChange={e => setRestockTarget(Number(e.target.value) || 0)}
                  className="h-8"
                />
              </div>
            </div>
           </>
          )}

          {/* Price calc feedback */}
          {mode === 'prices' && !isDiscount && price && priceQuantity && Number(priceQuantity) > 0 && (
             <div className="text-xs font-medium text-blue-800 bg-blue-50 p-2 rounded border border-blue-200 animate-in fade-in duration-300">
               Total Price: ${Number(price).toFixed(2)} for {priceQuantity} units 
               <span className="mx-2 opacity-30">|</span> 
               Unit Price: ${(Number(price) / Number(priceQuantity)).toFixed(2)} / {priceUnit || unit || "pcs"}
             </div>
          )}

          {mode === 'inventory' && (
             <div className="space-y-3">
               <div className="flex justify-between items-center">
                 <Label>Inventory Details</Label>
                 <Button type="button" variant="outline" size="sm" onClick={addInventoryEntry} className="h-7 text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Add Entry
                 </Button>
               </div>
               
               {inventoryEntries.map((entry, index) => (
                 <div key={entry.id} id={`entry-${entry.id}`} className="p-3 bg-gray-50 border rounded-lg space-y-3 relative group">
                   <div className="flex justify-between items-center gap-2">
                     <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Entry #{index + 1}</span>
                     <div className="flex gap-1">
                       {entry.quantity > 1 && (
                         <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-blue-600" onClick={() => splitInventoryEntry(entry)} title="Split entry">
                            <Split className="w-4 h-4" />
                         </Button>
                       )}
                       <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-600" onClick={() => removeInventoryEntry(entry.id)}>
                          <Trash2 className="w-4 h-4" />
                       </Button>
                     </div>
                   </div>
                   
                   {/* Location, Quantity, Amount, Unit layout */}
                   <div className="grid grid-cols-2 gap-3 items-start">
                     <div className="space-y-1.5 col-span-2">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Location</Label>
                       <LocationSelect value={entry.location} onChange={v => updateInventoryEntry(entry.id, 'location', v)} locations={locations} className={selectStyles} />
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Quantity (Count)</Label>
                       <div className="flex items-center gap-1.5">
                         <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0 border-gray-300" onClick={() => updateInventoryEntry(entry.id, 'quantity', Math.max(0.01, Number(entry.quantity) - 1))}>
                           <Minus className="w-3.5 h-3.5" />
                         </Button>
                         <Input 
                           type="number" step="any" min="0.01" 
                           value={entry.quantity} 
                           onChange={e => updateInventoryEntry(entry.id, 'quantity', Number(e.target.value))} 
                           className="h-8 text-sm bg-white text-center px-1"
                           placeholder="e.g. 1"
                           required={mode === 'inventory'}
                         />
                         <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0 border-gray-300" onClick={() => updateInventoryEntry(entry.id, 'quantity', Number(entry.quantity) + 1)}>
                           <Plus className="w-3.5 h-3.5" />
                         </Button>
                       </div>
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{entry.unit === 'pcs' ? 'Number of Pcs' : 'Amount per count'}</Label>
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
                       <UnitSelect value={entry.unit || ''} onChange={v => updateInventoryEntry(entry.id, 'unit', v)} className={selectStyles} />
                     </div>
                   </div>

                   {/* Expiry, Date Bought */}
                   <div className="grid grid-cols-2 gap-3 items-start mt-3">
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expiry</Label>
                       <div className="flex gap-1 items-center">
                         <Input type="date" value={entry.expiryDate || ""} onChange={e => updateInventoryEntry(entry.id, 'expiryDate', e.target.value)} className="h-8 text-sm bg-white flex-1 min-w-0" />
                         <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0 border-gray-300" onClick={() => updateInventoryEntry(entry.id, 'expiryDate', "")}>
                           <X className="w-3.5 h-3.5" />
                         </Button>
                       </div>
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date Bought</Label>
                       <div className="flex gap-1 items-center">
                         <Input type="date" value={entry.dateBought !== undefined ? entry.dateBought : (entry.dateAdded || "")} onChange={e => updateInventoryEntry(entry.id, 'dateBought', e.target.value)} className="h-8 text-sm bg-white flex-1 min-w-0" />
                         <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0 border-gray-300" onClick={() => updateInventoryEntry(entry.id, 'dateBought', "")}>
                           <X className="w-3.5 h-3.5" />
                         </Button>
                       </div>
                     </div>
                   </div>

                   {/* Opened Toggle */}
                   <div className="bg-white border rounded p-2 mt-2 space-y-2">
                     <div className="flex items-center space-x-2">
                       <input 
                         type="checkbox" 
                         id={`opened-${entry.id}`}
                         checked={entry.isOpened || false}
                         onChange={(e) => {
                           updateInventoryEntry(entry.id, 'isOpened', e.target.checked);
                           if (e.target.checked && !entry.openedDate && entry.quantity <= 1) {
                              updateInventoryEntry(entry.id, 'openedDate', new Date().toISOString().split('T')[0]);
                           }
                         }}
                         className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                       />
                       <Label htmlFor={`opened-${entry.id}`} className="text-xs font-semibold text-gray-600 cursor-pointer">
                         Item is opened
                       </Label>
                     </div>
                     {entry.isOpened && (
                       <div className="flex items-center gap-2 animate-in fade-in">
                           <Label className="text-[10px] uppercase font-semibold text-gray-400">Date Opened</Label>
                           <div className="flex gap-1 items-center w-full max-w-[200px]">
                             <Input type="date" value={entry.openedDate || ""} onChange={e => updateInventoryEntry(entry.id, 'openedDate', e.target.value)} className="h-8 text-sm flex-1 min-w-0" />
                             <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0 border-gray-300" onClick={() => updateInventoryEntry(entry.id, 'openedDate', "")}>
                               <X className="w-3.5 h-3.5" />
                             </Button>
                           </div>
                       </div>
                     )}
                   </div>

                   {/* Label, Tags */}
                   <div className="grid grid-cols-2 gap-3 items-start mt-3">
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
                  <Label className="font-semibold text-blue-900">{focusedPriceId && focusedPriceId !== 'new' ? "Edit Price Entry" : "Add Price Entry"}</Label>
                  <div className="flex items-center gap-2">
                    {focusedPriceId && focusedPriceId !== 'new' && (
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-xs text-red-600 hover:bg-red-50"
                        onClick={async () => {
                          if (confirm("Are you sure you want to delete this price entry?")) {
                            setLoading(true);
                            await onSave({ deletedPriceEntryId: focusedPriceId });
                          }
                        }}
                      >
                         <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                      </Button>
                    )}
                    <span className="text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Tracking</span>
                  </div>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs text-gray-600">Store / Merchant</Label>
                  <Input 
                    value={store} 
                    onChange={e => setStore(e.target.value)} 
                    placeholder="e.g. Costco, Walmart" 
                    className="h-8 text-sm bg-white" 
                    required={mode === 'prices'}
                    list="stores-list"
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
                      <Label className="text-xs text-gray-600">Quantity</Label>
                      <Input 
                        type="number" step="any" min="0.01" 
                        value={priceQuantity} 
                        onChange={e => setPriceQuantity(e.target.value)} 
                        placeholder="1" 
                        className="h-8 text-sm bg-white" 
                        required={mode === 'prices' && !isDiscount}
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
                    {dealPrice && dealQuantity && Number(dealQuantity) > 0 && (
                      <div className="text-xs font-medium text-blue-800 bg-blue-100/50 p-2 rounded border border-blue-200">
                        Calculated Unit Price: ${ (Number(dealPrice) / Number(dealQuantity)).toFixed(2) } / {priceUnit || unit || "unit"}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 col-span-2 items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Unit for price</Label>
                    <Input 
                      type="text" 
                      value={priceUnit} 
                      onChange={e => setPriceUnit(e.target.value)} 
                      placeholder={unit || "pcs"} 
                      className="h-8 text-sm bg-white" 
                      list="units-list"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Date observed</Label>
                    <Input 
                      type="date" 
                      value={priceDate} 
                      onChange={e => setPriceDate(e.target.value)} 
                      className="h-8 text-sm bg-white" 
                    />
                  </div>
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
              {["pcs", "g", "kg", "mL", "L"].map(u => (
                <option key={u} value={u} />
              ))}
            </datalist>
            {!restrictedMode && (
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea 
                  id="notes" 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)} 
                  placeholder="e.g. 200g needed for recipe" 
                />
              </div>
            )}
          </div>

          <Button type="submit" className="w-full mt-6" disabled={loading}>
            {loading ? "Saving..." : "Save Item"}
          </Button>
        </form>

        {!restrictedMode && mode === 'prices' && item && item.priceHistory && item.priceHistory.length > 0 && (
          <div className="px-1 pb-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Price History ({item.priceHistory.length})</h4>
              
              {item.priceHistory.length > 1 && (
                  <div className="h-32 w-full mb-4 mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={[...item.priceHistory].sort((a, b) => a.date.localeCompare(b.date)).map(e => {
                              const projection = deriveUnitPrice({
                                  totalPrice: e.isDiscount && e.dealPrice && e.dealQuantity ? Number(e.dealPrice) : Number(e.price),
                                  priceQuantity: e.isDiscount && e.dealQuantity ? Number(e.dealQuantity) : Number(e.quantity) || 1,
                                  priceUnit: e.unitStr || item.unit || "pcs",
                                  quantity: e.isDiscount && e.dealQuantity ? Number(e.dealQuantity) : Number(e.quantity) || 1,
                                  quantityUnit: e.unitStr || item.unit || "pcs"
                              });
                              return {
                                  date: new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                                  unitPrice: Number((projection.unitPrice ?? 0).toFixed(2))
                              };
                          })}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                              <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} tickMargin={8} minTickGap={15} />
                              <YAxis width={30} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px', padding: '4px 8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: number) => [`$${value.toFixed(2)}`, 'Unit Price']} labelStyle={{ color: '#6B7280', marginBottom: '2px' }} />
                              <Line type="monotone" dataKey="unitPrice" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3, fill: "#3B82F6", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                          </LineChart>
                      </ResponsiveContainer>
                  </div>
              )}

              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                  {[...item.priceHistory]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((entry) => (
                      <div key={entry.id} className="bg-gray-50 border rounded-lg p-2 text-xs flex justify-between items-center gap-2">
                          <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-gray-700">{entry.store || "Unknown Store"}</span>
                              <span className="text-gray-500">{entry.date}</span>
                          </div>
                          <div className="flex flex-col items-end gap-0.5">
                              {entry.isDiscount && entry.dealPrice && entry.dealQuantity ? (
                                  <>
                                      <span className="font-bold text-green-700">${Number(entry.dealPrice).toFixed(2)}</span>
                                      <span className="text-[10px] text-green-600">for {entry.dealQuantity} {entry.unitStr || item.unit || 'pcs'}</span>
                                  </>
                              ) : (
                                  <>
                                      <span className="font-bold text-blue-700">${Number(entry.price).toFixed(2)}</span>
                                      <span className="text-[10px] text-gray-500">/ {entry.unitStr || item.unit || 'pcs'}</span>
                                  </>
                              )}
                          </div>
                      </div>
                  ))}
              </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
