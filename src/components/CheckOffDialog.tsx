import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { GroceryItem, PriceEntry } from "../types";

export const STORES = [
  "Costco",
  "T&T",
  "No Frills",
  "RCS",
  "Walmart",
  "Loblaws",
  "Metro",
  "Sobeys",
  "Kroger",
  "Whole Foods",
  "Trader Joe's",
  "Target"
];

export const PRESET_UNITS = ["count", "g", "kg", "mL", "L", "lb"];

interface CheckOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: GroceryItem | undefined;
  onConfirm: (item: GroceryItem, priceEntry: Omit<PriceEntry, 'id'> | null) => Promise<void>;
}

export function CheckOffDialog({ open, onOpenChange, item, onConfirm }: CheckOffDialogProps) {
  const [loading, setLoading] = useState(false);
  const [trackPrice, setTrackPrice] = useState(true);
  const [price, setPrice] = useState<string>("");
  const [unitStr, setUnitStr] = useState<string>("");
  const [store, setStore] = useState<string>("");
  const [date, setDate] = useState<string>("");

  useEffect(() => {
    if (open && item) {
      setTrackPrice(true);
      setPrice("");
      setUnitStr(item.unit || "count");
      setStore("");
      
      const tzOffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
      const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 10);
      setDate(localISOTime);
    }
  }, [open, item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    setLoading(true);
    let priceEntry: Omit<PriceEntry, 'id'> | null = null;
    
    if (trackPrice && price !== "") {
      priceEntry = {
        date,
        price: Number(price),
        unitStr,
        store: store || "Unknown"
      };
    }

    try {
      await onConfirm(item, priceEntry);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Got {item.name}</DialogTitle>
          <DialogDescription>
            Marking {item.shoppingQuantity} {item.unit || 'count'} as purchased.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <input 
              type="checkbox" 
              id="trackPrice" 
              checked={trackPrice} 
              onChange={e => setTrackPrice(e.target.checked)} 
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <Label htmlFor="trackPrice">Track price for this purchase</Label>
          </div>

          {trackPrice && (
            <div className="space-y-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Price ($)</Label>
                  <Input 
                    id="price" 
                    type="number" 
                    step="any" 
                    min="0" 
                    value={price} 
                    onChange={e => setPrice(e.target.value)} 
                    placeholder="e.g. 4.99"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unitStr">Per Unit</Label>
                  <Input 
                    id="unitStr"
                    value={unitStr}
                    onChange={e => setUnitStr(e.target.value)}
                    placeholder="e.g. lb, kg, count"
                    list="price-units-list"
                    required
                  />
                  <datalist id="price-units-list">
                    {PRESET_UNITS.map(u => <option key={u} value={`per ${u}`} />)}
                    <option value="total" />
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="store">Store</Label>
                  <Input 
                    id="store"
                    value={store}
                    onChange={e => setStore(e.target.value)}
                    placeholder="e.g. Costco"
                    list="stores-list"
                    required
                  />
                  <datalist id="stores-list">
                    {STORES.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input 
                    id="date" 
                    type="date" 
                    value={date} 
                    onChange={e => setDate(e.target.value)} 
                    required
                  />
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
              {loading ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
