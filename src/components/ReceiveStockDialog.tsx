import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Plus, Trash2 } from "lucide-react";
import { GroceryItem, InventoryEntry } from "../types";

interface ReceiveStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: GroceryItem;
  defaultAmount?: number;
  locations: string[];
  onReceive: (entries: Omit<InventoryEntry, 'id'>[], checkOffAmount: number) => Promise<void>;
}

export function ReceiveStockDialog({ open, onOpenChange, item, defaultAmount = 1, locations, onReceive }: ReceiveStockDialogProps) {
  const [entries, setEntries] = useState<Omit<InventoryEntry, 'id'>[]>([]);
  const [checkOffAmount, setCheckOffAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && item) {
      const today = new Date().toISOString().split('T')[0];
      setEntries([{ location: item.locations?.[0] || item.location || "", quantity: defaultAmount, unit: item.unit, dateBought: today, dateAdded: today }]);
      setCheckOffAmount(defaultAmount);
    } else {
      setEntries([]);
      setCheckOffAmount(0);
    }
  }, [open, item, defaultAmount]);

  const addEntry = () => {
    const today = new Date().toISOString().split('T')[0];
    setEntries([...entries, { 
      location: entries[0]?.location || "", 
      quantity: 1, 
      unit: item?.unit || "",
      dateBought: today,
      dateAdded: today
    }]);
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: keyof Omit<InventoryEntry, 'id'>, value: string | number | string[]) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], [field]: value };
    setEntries(newEntries);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onReceive(entries, checkOffAmount);
    setLoading(false);
    onOpenChange(false);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add {item.name} to Inventory</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 max-h-[80vh] overflow-y-auto px-1">
          <datalist id="receive-locations-list">
            {locations.map(loc => (
              <option key={loc} value={loc} />
            ))}
          </datalist>
          <datalist id="units-list">
            {["g", "kg", "ml", "L", "oz", "lb", "unit", "pack", "bottle", "can", "box", "bag"].map(u => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <div className="space-y-3">
             <div className="flex justify-between items-center">
               <Label>Inventory Pieces</Label>
               <Button type="button" variant="outline" size="sm" onClick={addEntry} className="h-7 text-xs">
                  <Plus className="w-3 h-3 mr-1" /> Add Piece
               </Button>
             </div>
             
             {entries.map((entry, index) => (
               <div key={index} className="p-3 bg-gray-50 border rounded-lg space-y-3 relative group">
                 <div className="flex justify-between items-center gap-2">
                   <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Piece #{index + 1}</span>
                   {entries.length > 1 && (
                     <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-600" onClick={() => removeEntry(index)}>
                        <Trash2 className="w-4 h-4" />
                     </Button>
                   )}
                 </div>
                 
                 <div className="grid grid-cols-3 gap-3">
                   <div className="space-y-1.5">
                     <Label className="text-xs">Location</Label>
                     <Input 
                       value={entry.location} 
                       onChange={e => updateEntry(index, 'location', e.target.value)} 
                       placeholder="e.g. Pantry" 
                       list="receive-locations-list"
                       className="h-8 text-sm"
                       required
                     />
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-xs">Quantity (Count)</Label>
                     <Input 
                       type="number" step="any" min="0.01" 
                       value={entry.quantity} 
                       onChange={e => updateEntry(index, 'quantity', Number(e.target.value))} 
                       className="h-8 text-sm"
                       placeholder="e.g. 1"
                       required
                     />
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-xs">Amount per count</Label>
                     <Input 
                       type="number" step="any" min="0" 
                       value={entry.amount || ""} 
                       onChange={e => updateEntry(index, 'amount', Number(e.target.value))} 
                       className="h-8 text-sm"
                       placeholder="e.g. 500"
                     />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                   <div className="space-y-1.5">
                       <Label className="text-xs text-gray-500">Unit</Label>
                       <Input 
                         type="text" 
                         value={entry.unit || ""} 
                         onChange={e => updateEntry(index, 'unit', e.target.value)} 
                         list="units-list"
                         placeholder="g, ml, pack"
                         className="h-8 text-sm"
                       />
                    </div>
                   <div className="space-y-1.5">
                       <Label className="text-xs text-gray-500">Label</Label>
                       <Input 
                         type="text" 
                         value={entry.label || ""} 
                         onChange={e => updateEntry(index, 'label', e.target.value)} 
                         placeholder="e.g. For stir fry"
                         className="h-8 text-sm"
                       />
                    </div>
                   <div className="space-y-1.5">
                       <Label className="text-xs text-gray-500">Expiry Date</Label>
                       <Input 
                         type="date" 
                         value={entry.expiryDate || ""} 
                         onChange={e => updateEntry(index, 'expiryDate', e.target.value)} 
                         className="h-8 text-sm text-gray-600 px-1"
                       />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Date Bought</Label>
                        <Input 
                          type="date" 
                          value={entry.dateBought || entry.dateAdded || ""} 
                          onChange={e => updateEntry(index, 'dateBought', e.target.value)} 
                          className="h-8 text-sm text-gray-600 px-1"
                        />
                    </div>
                    <div className="space-y-1.5 col-span-2 lg:col-span-4">
                        <Label className="text-xs text-gray-500">Tags</Label>
                        <Input 
                          type="text" 
                          value={entry.tags?.join(", ") || ""} 
                          onChange={e => updateEntry(index, 'tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))} 
                          placeholder="e.g. frozen"
                          className="h-8 text-sm"
                        />
                    </div>
                 </div>
               </div>
             ))}
          </div>

          <div className="space-y-3 pt-2">
            <div className="bg-orange-50 border border-orange-100 p-3 rounded-lg flex items-center justify-between gap-4">
               <div>
                  <Label className="text-orange-900 font-medium text-sm">Processing Queue</Label>
                  <p className="text-xs text-orange-700">Pending to process: {item.unprocessedQuantity || 0} {item.unit}</p>
               </div>
               <div className="space-y-1 text-right max-w-28">
                  <Label className="text-xs text-orange-800">Process amount</Label>
                  <Input 
                    type="number" step="any" min="0" max={(item.unprocessedQuantity || 0) > 0 ? item.unprocessedQuantity : undefined}
                    value={checkOffAmount} 
                    onChange={e => setCheckOffAmount(Number(e.target.value))} 
                    className="h-8 text-sm bg-white border-orange-200"
                  />
               </div>
            </div>
          </div>

          <Button type="submit" className="w-full mt-6" disabled={loading || entries.length === 0}>
             {loading ? "Saving..." : "Add to Inventory"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
