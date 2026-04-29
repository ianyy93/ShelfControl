import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { GroceryItem, CATEGORIES, Category, InventoryEntry } from "../types";

interface ItemDialogProps {
  item?: GroceryItem;
  existingItems?: GroceryItem[];
  locations?: string[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (item: Partial<GroceryItem>) => Promise<void>;
  title: string;
  defaultMode: 'shopping' | 'inventory';
}

export function ItemDialog({ item, existingItems, locations = [], isOpen, onOpenChange, onSave, title, defaultMode }: ItemDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("Produce");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<'shopping' | 'inventory'>(defaultMode);
  
  // Internal state for edits
  const [shoppingQuantity, setShoppingQuantity] = useState<string | number>(0);
  const [inventoryEntries, setInventoryEntries] = useState<InventoryEntry[]>([]);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (item) {
        setName(item.name);
        setCategory(item.category);
        setUnit(item.unit || "");
        setNotes(item.notes || "");
        setShoppingQuantity(item.shoppingQuantity || 0);
        setInventoryEntries(item.inventoryEntries || []);
        
        // Set mode to whatever it has positive quantity for, or keep default
        if (defaultMode === 'shopping') {
            setMode('shopping');
        } else {
            setMode('inventory');
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
        } else {
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

    await onSave({
      name,
      category,
      unit,
      locations: Array.from(derivedLocations),
      notes,
      inventoryEntries,
      inventoryQuantity: derivedInventoryQuant,
      shoppingQuantity: Number(shoppingQuantity) || 0
    });
    setLoading(false);
  };

  const addInventoryEntry = () => {
    setInventoryEntries([...inventoryEntries, { id: Math.random().toString(36).substr(2, 9), location: "", quantity: 1, unit: unit || item?.unit || "" }]);
  };

  const removeInventoryEntry = (id: string) => {
    setInventoryEntries(inventoryEntries.filter(e => e.id !== id));
  };

  const updateInventoryEntry = (id: string, field: keyof InventoryEntry, value: string | number | string[]) => {
    setInventoryEntries(inventoryEntries.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    if (!item && existingItems) {
      const match = existingItems.find(i => i.name.toLowerCase().trim() === val.toLowerCase().trim());
      if (match) {
        setCategory(match.category);
        if (match.unit) setUnit(match.unit);
      }
    }
  };

  const handleModeChange = (v: string) => {
    const newMode = v as 'shopping'|'inventory';
    setMode(newMode);
    if (!item) {
        if (newMode === 'shopping' && shoppingQuantity === 0 && inventoryEntries.length === 0) {
            setShoppingQuantity(1);
        } else if (newMode === 'inventory' && inventoryEntries.length === 0 && shoppingQuantity === 0) {
            setInventoryEntries([{ id: Math.random().toString(36).substr(2, 9), location: "", quantity: 1, unit }]);
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
             <Label>Adding to</Label>
             <Tabs value={mode} onValueChange={handleModeChange} className="w-full">
               <TabsList className="grid w-full grid-cols-2">
                 <TabsTrigger value="shopping">Shopping List</TabsTrigger>
                 <TabsTrigger value="inventory">Inventory</TabsTrigger>
               </TabsList>
             </Tabs>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Item Name</Label>
            <Input id="name" value={name} list="existing-items-list" onChange={handleNameChange} required placeholder="e.g. Milk, Apples, Bread" />
            <datalist id="existing-items-list">
              {Array.from(new Set(existingItems?.map(i => i.name))).map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <select 
                  id="category"
                  className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={category} 
                  onChange={e => setCategory(e.target.value as Category)}
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Default Unit (Optional)</Label>
                <Input id="unit" value={unit} onChange={e => handleUnitChange(e.target.value)} list="units-list" placeholder="pcs, kg, lbs..." />
              </div>
          </div>
          
          {mode === 'shopping' && (
            <div className="space-y-2">
              <Label>Shopping Quantity</Label>
              <Input type="number" step="any" min="0" value={shoppingQuantity} onChange={e => setShoppingQuantity(e.target.value)} required={mode==='shopping'} />
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
                 <div key={entry.id} className="p-3 bg-gray-50 border rounded-lg space-y-3 relative group">
                   <div className="flex justify-between items-center gap-2">
                     <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Entry #{index + 1}</span>
                     <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-600" onClick={() => removeInventoryEntry(entry.id)}>
                        <Trash2 className="w-4 h-4" />
                     </Button>
                   </div>
                   
                   <div className="grid grid-cols-3 gap-3">
                     <div className="space-y-1.5">
                       <Label className="text-xs">Location</Label>
                       <Input 
                         value={entry.location} 
                         onChange={e => updateInventoryEntry(entry.id, 'location', e.target.value)} 
                         placeholder="e.g. Pantry" 
                         list="locations-list"
                         className="h-8 text-sm"
                         required={mode === 'inventory'}
                       />
                       <datalist id="locations-list">
                         {locations.map(loc => (
                           <option key={loc} value={loc} />
                         ))}
                       </datalist>
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-xs">Quantity (Count)</Label>
                       <Input 
                         type="number" step="any" min="0.01" 
                         value={entry.quantity} 
                         onChange={e => updateInventoryEntry(entry.id, 'quantity', Number(e.target.value))} 
                         className="h-8 text-sm"
                         placeholder="e.g. 1"
                         required={mode === 'inventory'}
                       />
                     </div>
                     <div className="space-y-1.5">
                       <Label className="text-xs">Amount per count</Label>
                       <Input 
                         type="number" step="any" min="0" 
                         value={entry.amount || ""} 
                         onChange={e => updateInventoryEntry(entry.id, 'amount', Number(e.target.value))} 
                         className="h-8 text-sm"
                         placeholder="e.g. 500"
                       />
                     </div>
                   </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                      <div className="space-y-1.5">
                          <Label className="text-xs text-gray-500">Unit</Label>
                          <Input type="text" value={entry.unit || ""} onChange={e => updateInventoryEntry(entry.id, 'unit', e.target.value)} list="units-list" placeholder="g, ml, pack" className="h-8 text-sm" />
                      </div>
                      <div className="space-y-1.5">
                          <Label className="text-xs text-gray-500">Label</Label>
                          <Input type="text" value={entry.label || ""} onChange={e => updateInventoryEntry(entry.id, 'label', e.target.value)} placeholder="e.g. For stir fry" className="h-8 text-sm" />
                      </div>
                      <div className="space-y-1.5">
                          <Label className="text-xs text-gray-500">Expiry</Label>
                          <Input type="date" value={entry.expiryDate || ""} onChange={e => updateInventoryEntry(entry.id, 'expiryDate', e.target.value)} className="h-8 text-sm text-gray-600 px-1" />
                      </div>
                      <div className="space-y-1.5">
                          <Label className="text-xs text-gray-500">Tags (comma sep)</Label>
                          <Input type="text" value={entry.tags?.join(", ") || ""} onChange={e => updateInventoryEntry(entry.id, 'tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))} placeholder="e.g. frozen" className="h-8 text-sm" />
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

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea 
              id="notes" 
              value={notes} 
              onChange={e => setNotes(e.target.value)} 
              placeholder="e.g. 200g needed for recipe" 
            />
          </div>

          <Button type="submit" className="w-full mt-6" disabled={loading}>
            {loading ? "Saving..." : "Save Item"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
